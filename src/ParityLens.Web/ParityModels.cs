namespace ParityLens.Web;

using System.Text.Json.Serialization;
using System.Text.Json.Nodes;

public sealed record CatalogResponse(
    IReadOnlyList<EntityDefinition> Entities,
    IReadOnlyList<ScenarioDefinition> Scenarios,
    IReadOnlyList<string> Versions);

public sealed record EntityDefinition(
    string Id,
    string Name,
    string Icon,
    IReadOnlyList<OperationDefinition> Operations);

public sealed record OperationDefinition(
    string Id,
    string Name,
    string Method,
    string Route,
    string ResponseShape,
    string Description)
{
    [JsonIgnore]
    public OperationRuntimeDefinition Runtime { get; init; } = null!;
}

public sealed class ParityDataDocument
{
    public required string SchemaVersion { get; init; }
    public required IReadOnlyList<string> Versions { get; init; }
    public required IReadOnlyList<ScenarioDefinition> Scenarios { get; init; }
    public required IReadOnlyList<SoftwareLayerDefinition> Layers { get; init; }
    public required IReadOnlyList<FunctionPairingDefinition> Functions { get; init; }
    public required IReadOnlyList<FieldPairingDefinition> Fields { get; init; }
    public required IReadOnlyList<OutcomePairingDefinition> Outcomes { get; init; }
    public required IReadOnlyList<ErrorPairingDefinition> Errors { get; init; }
    public required IReadOnlyList<EnumPairingDefinition> Enums { get; init; }
    public required IReadOnlyList<EntityRuntimeDefinition> Entities { get; init; }
}

public sealed class EntityRuntimeDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Icon { get; init; }
    public required IReadOnlyList<OperationRuntimeDefinition> Operations { get; init; }
}

public sealed class OperationRuntimeDefinition
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Method { get; init; }
    public required string Route { get; init; }
    public required string ResponseShape { get; init; }
    public required string Description { get; init; }
    public IReadOnlyList<OperationParameterDefinition> ParameterSchema { get; init; } = [];
    public required FunctionPairingDefinition RootFunction { get; init; }
    public required OperationArtifact Artifact { get; init; }

    [JsonIgnore]
    public string EntityId { get; set; } = string.Empty;

    [JsonIgnore]
    public IReadOnlyList<SoftwareLayerDefinition> Layers { get; set; } = [];

    [JsonIgnore]
    public IReadOnlyList<FunctionPairingDefinition> Functions { get; set; } = [];

    [JsonIgnore]
    public IReadOnlyList<FieldPairingDefinition> Fields { get; set; } = [];

    [JsonIgnore]
    public IReadOnlyList<OutcomePairingDefinition> Outcomes { get; set; } = [];

    [JsonIgnore]
    public IReadOnlyList<ErrorPairingDefinition> Errors { get; set; } = [];

    [JsonIgnore]
    public IReadOnlyList<EnumPairingDefinition> Enums { get; set; } = [];
}

[JsonConverter(typeof(JsonStringEnumConverter<FunctionTimelineRole>))]
public enum FunctionTimelineRole
{
    step,
    serviceBoundary,
}

public sealed record SoftwareLayerDefinition(string Id, string Name);

public sealed class FunctionPairingDefinition
{
    public required string Id { get; init; }
    public required string LayerId { get; init; }
    public FunctionTimelineRole Role { get; init; } = FunctionTimelineRole.step;
    public IReadOnlyList<FunctionEndpointDefinition> Endpoints { get; init; } = [];
    public IReadOnlyDictionary<string, IReadOnlyList<string>> Aliases { get; init; } =
        new Dictionary<string, IReadOnlyList<string>>();
}

public sealed record FunctionEndpointDefinition(string RuntimeId, string Symbol);

public sealed class FieldPairingDefinition
{
    public required string Id { get; init; }
    public IReadOnlyList<FieldEndpointDefinition> Endpoints { get; init; } = [];
    public IReadOnlyDictionary<string, IReadOnlyList<string>> Aliases { get; init; } =
        new Dictionary<string, IReadOnlyList<string>>();
    public bool Excluded { get; init; }
}

public sealed class FieldEndpointDefinition
{
    public required string RuntimeId { get; init; }
    public string Scope { get; init; } = "function";
    public required string OwnerTypeSymbol { get; init; }
    public string MemberPath { get; init; } = string.Empty;
    public string? FunctionSymbol { get; init; }
    public string? Direction { get; init; }
    public string? Path { get; init; }
}

public sealed class OutcomePairingDefinition
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<string>> Aliases { get; init; }
}

public sealed class ErrorPairingDefinition
{
    public required string Id { get; init; }
    public required string Category { get; init; }
    public int? StatusCode { get; init; }
    public bool Retryable { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<string>> Aliases { get; init; }
}

public sealed record CanonicalOutcome(
    string Id,
    string Kind,
    string ValueState,
    CanonicalError? Error);

public sealed record CanonicalError(
    string Id,
    string Category,
    int? StatusCode,
    bool Retryable,
    string? Message,
    string? RuntimeType);

public sealed class EnumPairingDefinition
{
    public required string Id { get; init; }
    public bool Flags { get; init; }
    public IReadOnlyList<EnumEndpointDefinition> Endpoints { get; init; } = [];
    public IReadOnlyList<EnumMemberPairingDefinition> Members { get; init; } = [];
    public IReadOnlyDictionary<string, IReadOnlyList<string>> Aliases { get; init; } =
        new Dictionary<string, IReadOnlyList<string>>();
    public IReadOnlyList<EnumValueDefinition> Values { get; init; } = [];
}

public sealed record EnumEndpointDefinition(string RuntimeId, string Symbol);

public sealed class EnumMemberPairingDefinition
{
    public required IReadOnlyDictionary<string, string> Symbols { get; init; }
}

public sealed class EnumValueDefinition
{
    public required string Name { get; init; }
    public required long Value { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<string>> Aliases { get; init; }
}

public sealed class OperationParameterDefinition
{
    public required string Id { get; init; }
    public required string Label { get; init; }
    public required string Source { get; init; }
    public required string Kind { get; init; }
    public bool Required { get; init; }
}

public sealed class OperationArtifact
{
    public required InvocationArtifact Invocation { get; init; }
    public required HttpRequestArtifact Request { get; init; }
    public required HttpResponseArtifact Response { get; init; }
}

public sealed class InvocationArtifact
{
    public required string Tenant { get; init; }
    public required string Token { get; init; }
    public string? KeyKind { get; init; }
    public string? Key { get; init; }
    public IReadOnlyList<string> QuerySelect { get; init; } = [];
    public string? QueryFilter { get; init; }
    public string? QueryPropertySet { get; init; }
    public int? QueryTop { get; init; }
    public int? QuerySkip { get; init; }
    public IReadOnlyList<string> QueryOrderBy { get; init; } = [];
    public string? QueryExpand { get; init; }
    public JsonObject Arguments { get; init; } = new();
}

public sealed class HttpRequestArtifact
{
    public required string Method { get; init; }
    public required string PathContains { get; init; }
    public IReadOnlyDictionary<string, string> PathAliases { get; init; } = new Dictionary<string, string>();
    public IReadOnlyDictionary<string, string> Headers { get; init; } = new Dictionary<string, string>();
    public JsonNode? Body { get; init; }
}

public sealed class HttpResponseArtifact
{
    public required int StatusCode { get; init; }
    public required string Version { get; init; }
    public IReadOnlyDictionary<string, string> Headers { get; init; } = new Dictionary<string, string>();
    public JsonNode? Body { get; init; }
    public string? BodyText { get; init; }
}

public sealed record ScenarioDefinition(
    string Id,
    string Name,
    string Summary,
    string Tone,
    ScenarioResponseDefinition? Response);

public sealed record ScenarioResponseDefinition(
    int StatusCode,
    string Version,
    IReadOnlyDictionary<string, string> Headers,
    string BodyText);

public sealed record ComparisonRequest(
    string EntityId,
    string OperationId,
    string ScenarioId,
    string BaselineVersion,
    string CandidateVersion);

public sealed record ComparisonRun(
    string Id,
    DateTimeOffset StartedAt,
    string EntityId,
    string EntityName,
    string OperationId,
    string OperationName,
    string ScenarioId,
    string ScenarioName,
    string Verdict,
    string? FirstDivergenceId,
    ExecutionResult Baseline,
    ExecutionResult Candidate,
    IReadOnlyList<TracePair> Trace,
    IReadOnlyList<JsonDifference> Differences,
    IReadOnlyList<SoftwareLayerDefinition> Layers,
    IReadOnlyList<FieldPairingDefinition> Fields,
    IReadOnlyList<OutcomePairingDefinition> Outcomes,
    IReadOnlyList<ErrorPairingDefinition> Errors,
    IReadOnlyList<EnumPairingDefinition> Enums);

public sealed record ExecutionResult(
    string Version,
    int StatusCode,
    string StatusText,
    int DurationMs,
    JsonNode Response,
    CanonicalOutcome Outcome);

public sealed record TracePair(
    string Id,
    int Order,
    string Kind,
    TraceStep? Baseline,
    TraceStep? Candidate);

public sealed record TraceStep(
    string Id,
    string Label,
    string Function,
    int DurationMs,
    string Status,
    JsonObject Data);

public sealed record JsonDifference(
    string FieldId,
    string Path,
    string Kind,
    JsonNode? Baseline,
    JsonNode? Candidate);