namespace ParityLens.Web;

using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class OperationCatalog
{
    private const string SupportedSchemaVersion = "1.0.0";
    private readonly object sync = new();
    private ParityDataDocument data = null!;
    private IReadOnlyList<EntityDefinition> entities = [];

    public OperationCatalog()
        : this(ResolveDataPath())
    {
    }

    public OperationCatalog(string path)
    {
        this.DataPath = Path.GetFullPath(path);
        (this.data, this.entities) = ParseDocument(File.ReadAllText(this.DataPath), this.DataPath);
    }

    public string DataPath { get; }

    public void ReplaceDocument(string json)
    {
        (ParityDataDocument Data, IReadOnlyList<EntityDefinition> Entities) parsed = ParseDocument(json, "edited parity data");
        lock (this.sync)
        {
            this.data = parsed.Data;
            this.entities = parsed.Entities;
        }
    }

    public static IReadOnlyList<string> ValidateDocument(string json)
    {
        try
        {
            _ = ParseDocument(json, "edited parity data");
            return [];
        }
        catch (Exception exception)
        {
            return [exception.Message];
        }
    }

    public CatalogResponse GetCatalog()
    {
        lock (this.sync)
        {
            return new(this.entities, this.data.Scenarios, this.data.Versions);
        }
    }

    public (EntityDefinition Entity, OperationDefinition Operation, ScenarioDefinition Scenario) Resolve(
        ComparisonRequest request)
    {
        lock (this.sync)
        {
            EntityDefinition entity = this.entities.FirstOrDefault(item => item.Id == request.EntityId)
                ?? throw new ArgumentException($"Unknown entity '{request.EntityId}'.");
            OperationDefinition operation = entity.Operations.FirstOrDefault(item => item.Id == request.OperationId)
                ?? throw new ArgumentException($"Unknown operation '{request.OperationId}' for '{entity.Name}'.");
            ScenarioDefinition scenario = this.data.Scenarios.FirstOrDefault(item => item.Id == request.ScenarioId)
                ?? throw new ArgumentException($"Unknown scenario '{request.ScenarioId}'.");
            return (entity, operation, scenario);
        }
    }

    private static (ParityDataDocument Data, IReadOnlyList<EntityDefinition> Entities) ParseDocument(
        string json,
        string source)
    {
        ParityDataDocument data = JsonSerializer.Deserialize<ParityDataDocument>(
            json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException($"Parity data '{source}' is empty.");
        if (data.SchemaVersion != SupportedSchemaVersion)
        {
            throw new InvalidOperationException(
                $"Unsupported parity data schema '{data.SchemaVersion}'; expected '{SupportedSchemaVersion}'.");
        }

        var entityIds = new HashSet<string>(StringComparer.Ordinal);
        IReadOnlyList<EntityDefinition> entities = data.Entities.Select(entity =>
        {
            if (!entityIds.Add(entity.Id))
            {
                throw new InvalidOperationException($"Duplicate entity ID '{entity.Id}' in '{source}'.");
            }

            var operationIds = new HashSet<string>(StringComparer.Ordinal);
            IReadOnlyList<OperationDefinition> operations = entity.Operations.Select(operation =>
            {
                if (!operationIds.Add(operation.Id))
                {
                    throw new InvalidOperationException($"Duplicate operation ID '{entity.Id}/{operation.Id}' in '{source}'.");
                }
                operation.EntityId = entity.Id;
                operation.Layers = data.Layers;
                operation.Functions = data.Functions;
                operation.Fields = data.Fields;
                operation.Outcomes = data.Outcomes;
                operation.Errors = data.Errors;
                operation.Enums = data.Enums;
                return new OperationDefinition(
                    operation.Id,
                    operation.Name,
                    operation.Method,
                    operation.Route,
                    operation.ResponseShape,
                    operation.Description)
                {
                    Runtime = operation,
                };
            }).ToArray();
            return new EntityDefinition(entity.Id, entity.Name, entity.Icon, operations);
        }).ToArray();
        return (data, entities);
    }

    private static string ResolveDataPath()
    {
        string[] candidates =
        [
            Path.Combine(Directory.GetCurrentDirectory(), "Data", "parity-data.v1.json"),
            Path.Combine(Directory.GetCurrentDirectory(), "samples", "parity-data.v1.json"),
            Path.Combine(AppContext.BaseDirectory, "samples", "parity-data.v1.json"),
        ];
        return candidates.FirstOrDefault(File.Exists)
            ?? throw new FileNotFoundException(
                "Unable to locate Data/parity-data.v1.json or the bundled sample catalog.",
                candidates[0]);
    }
}

public sealed class ComparisonSimulator
{
    private const int RunLimit = 100;
    private readonly ConcurrentQueue<ComparisonRun> recentRuns = new();
    private readonly OperationCatalog catalog;
    private readonly IParityRunner? parityRunner;

    public ComparisonSimulator(OperationCatalog catalog)
        : this(catalog, null)
    {
    }

    public ComparisonSimulator(
        OperationCatalog catalog,
        IParityRunner? parityRunner)
    {
        this.catalog = catalog;
        this.parityRunner = parityRunner;
    }

    public IReadOnlyList<ComparisonRun> GetRecentRuns() => recentRuns.Reverse().ToArray();

    public async Task<ComparisonRun> RunAsync(
        ComparisonRequest request,
        string simulatorBaseUrl,
        CancellationToken cancellationToken)
    {
        if (parityRunner is null)
        {
            throw new InvalidOperationException(
                "No Parity Lens integration is configured. See docs/integrations.md.");
        }

        (EntityDefinition entity, OperationDefinition operation, ScenarioDefinition scenario) = catalog.Resolve(request);
        IReadOnlyList<TracePair> trace = await parityRunner.CaptureAsync(
            entity,
            operation,
            scenario,
            request.BaselineVersion,
            request.CandidateVersion,
            simulatorBaseUrl,
            cancellationToken).ConfigureAwait(false);
        ExecutionResult baseline = CreateExecutionResult(request.BaselineVersion, operation, trace, baseline: true);
        ExecutionResult candidate = CreateExecutionResult(request.CandidateVersion, operation, trace, baseline: false);
        IReadOnlyList<JsonDifference> differences = JsonDiffer.Compare(
            baseline.Response,
            candidate.Response,
            operation.Runtime.Fields);
        string? firstDivergence = trace.FirstOrDefault(step => step.Kind != "matched")?.Id;
        return Store(new ComparisonRun(
            $"run-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}",
            DateTimeOffset.UtcNow,
            entity.Id,
            entity.Name,
            operation.Id,
            operation.Name,
            scenario.Id,
            scenario.Name,
            firstDivergence is null && differences.Count == 0 ? "matched" : "diverged",
            firstDivergence,
            baseline,
            candidate,
            trace,
            differences,
            operation.Runtime.Layers,
            operation.Runtime.Fields,
            operation.Runtime.Outcomes,
            operation.Runtime.Errors,
            operation.Runtime.Enums));
    }

    private static ExecutionResult CreateExecutionResult(
        string version,
        OperationDefinition operation,
        IReadOnlyList<TracePair> trace,
        bool baseline)
    {
        TracePair? root = trace.FirstOrDefault(pair => pair.Id == operation.Id);
        TraceStep? step = baseline ? root?.Baseline : root?.Candidate;
        if (step is null)
        {
            return new ExecutionResult(
                version,
                StatusCodes.Status501NotImplemented,
                "Not implemented",
                0,
                new JsonObject
                {
                    ["error"] = new JsonObject
                    {
                        ["code"] = "OperationNotImplemented",
                        ["message"] = $"{version} does not implement {operation.Id}.",
                    },
                },
                new CanonicalOutcome(
                    "outcome.err",
                    "failure",
                    "none",
                    new CanonicalError(
                        "error.client",
                        "client",
                        StatusCodes.Status501NotImplemented,
                        false,
                        $"{version} does not implement {operation.Id}.",
                        "OperationNotImplemented")));
        }

        JsonNode response = step.Data["output"]?.DeepClone() ?? new JsonObject();
        JsonNode? diagnostic = response["diagnostic.info"];
        int statusCode = ReadStatusCode(diagnostic) ?? (step.Status == "ok" ? StatusCodes.Status200OK : StatusCodes.Status500InternalServerError);
        string statusText = ReadString(diagnostic?["diagnostic.protocol-status"])
            ?? ReadString(diagnostic?["diagnostic.status-code"])
            ?? (step.Status == "ok" ? "OK" : "Error");
        CanonicalOutcome outcome = step.Data["outcome"]?.Deserialize<CanonicalOutcome>(
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? OutcomeMapper.Map(
                response,
                step.Status == "ok",
                version,
                operation.Runtime.Outcomes,
                operation.Runtime.Errors);
        return new ExecutionResult(version, statusCode, statusText, step.DurationMs, response, outcome);
    }

    private static int? ReadStatusCode(JsonNode? diagnostic)
    {
        JsonNode? status = diagnostic?["diagnostic.status-code"]
            ?? diagnostic?["diagnostic.http-response"]?["diagnostic.status-code"]
            ?? diagnostic?["json:http_response_message"]?["diagnostic.status-code"];
        if (status is JsonValue value && value.TryGetValue<int>(out int numericStatus))
        {
            return numericStatus;
        }

        return int.TryParse(ReadString(status), out int parsedStatus) ? parsedStatus : null;
    }

    private static string? ReadString(JsonNode? value) =>
        value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out string? text) ? text : null;

    private ComparisonRun Store(ComparisonRun run)
    {
        recentRuns.Enqueue(run);
        while (recentRuns.Count > RunLimit)
        {
            recentRuns.TryDequeue(out _);
        }

        return run;
    }

}

internal static class JsonDiffer
{
    public static IReadOnlyList<JsonDifference> Compare(
        JsonNode? baseline,
        JsonNode? candidate,
        IReadOnlyList<FieldPairingDefinition>? fields = null)
    {
        var differences = new List<JsonDifference>();
        CompareNode("$", null, baseline, candidate, baselinePresent: true, candidatePresent: true, fields ?? [], differences);
        return differences;
    }

    private static void CompareNode(
        string path,
        string? fieldId,
        JsonNode? baseline,
        JsonNode? candidate,
        bool baselinePresent,
        bool candidatePresent,
        IReadOnlyList<FieldPairingDefinition> fields,
        List<JsonDifference> differences)
    {
        if (fieldId is not null && fields.Any(field => field.Excluded && field.Id == fieldId))
        {
            return;
        }
        if (!baselinePresent || !candidatePresent)
        {
            differences.Add(Difference(fieldId, path, baselinePresent ? "removed" : "added", baseline, candidate));
            return;
        }
        if (baseline is null || candidate is null)
        {
            if (!JsonNode.DeepEquals(baseline, candidate))
            {
                differences.Add(Difference(fieldId, path, baseline is null ? "added" : "removed", baseline, candidate));
            }
            return;
        }

        if (baseline is JsonObject baselineObject && candidate is JsonObject candidateObject)
        {
            foreach (string key in baselineObject.Select(pair => pair.Key).Union(candidateObject.Select(pair => pair.Key)).Order())
            {
                CompareNode(
                    $"{path}[{JsonSerializer.Serialize(key)}]",
                    key.StartsWith("json:", StringComparison.Ordinal) ? null : key,
                    baselineObject[key],
                    candidateObject[key],
                    baselineObject.ContainsKey(key),
                    candidateObject.ContainsKey(key),
                    fields,
                    differences);
            }
            return;
        }

        if (baseline is JsonArray baselineArray && candidate is JsonArray candidateArray)
        {
            int count = Math.Max(baselineArray.Count, candidateArray.Count);
            for (int index = 0; index < count; index++)
            {
                CompareNode(
                    $"{path}[{index}]",
                    fieldId,
                    index < baselineArray.Count ? baselineArray[index] : null,
                    index < candidateArray.Count ? candidateArray[index] : null,
                    index < baselineArray.Count,
                    index < candidateArray.Count,
                    fields,
                    differences);
            }
            return;
        }

        if (!JsonNode.DeepEquals(baseline, candidate))
        {
            differences.Add(Difference(
                fieldId,
                path,
                baseline.GetType() == candidate.GetType() ? "changed" : "type-changed",
                baseline,
                candidate));
        }
    }

    private static JsonDifference Difference(
        string? fieldId,
        string path,
        string kind,
        JsonNode? baseline,
        JsonNode? candidate)
    {
        return new JsonDifference(fieldId ?? $"json:{path}", path, kind, baseline?.DeepClone(), candidate?.DeepClone());
    }
}