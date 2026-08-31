namespace ParityLens.Web;

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

public sealed class ParityDataWorkspaceService
{
    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };
    private readonly OperationCatalog catalog;
    private readonly string activePath;
    private readonly string versionsPath;
    private readonly SemaphoreSlim gate = new(1, 1);

    public ParityDataWorkspaceService(OperationCatalog catalog)
        : this(catalog, catalog.DataPath)
    {
    }

    public ParityDataWorkspaceService(OperationCatalog catalog, string activePath)
    {
        this.catalog = catalog;
        this.activePath = activePath;
        this.versionsPath = Path.Combine(Path.GetDirectoryName(activePath)!, "parity-data.versions");
    }

    public async Task<ParityDataWorkspace> GetWorkspaceAsync(CancellationToken cancellationToken)
    {
        JsonNode document = JsonNode.Parse(await File.ReadAllTextAsync(this.activePath, cancellationToken))
            ?? throw new InvalidOperationException("The active parity data document is empty.");
        EnsureValidDocument(document);
        IReadOnlyList<ParityDataVersion> versions = await this.GetVersionsAsync(cancellationToken);
        return new ParityDataWorkspace(document, versions, GetStatistics(document));
    }

    public async Task<ParityDataValidationResult> ValidateAsync(
        JsonNode? document,
        CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        cancellationToken.ThrowIfCancellationRequested();
        return Validate(document);
    }

    public async Task<ParityDataHotloadResult> HotloadAsync(
        JsonNode? document,
        CancellationToken cancellationToken)
    {
        ParityDataValidationResult validation = Validate(document);
        if (!validation.Valid)
        {
            return new(false, validation);
        }
        await this.gate.WaitAsync(cancellationToken);
        try
        {
            this.catalog.ReplaceDocument(document!.ToJsonString());
            return new(true, validation);
        }
        finally
        {
            this.gate.Release();
        }
    }

    public async Task<IReadOnlyList<ParityDataVersion>> GetVersionsAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(this.versionsPath))
        {
            return [];
        }

        var versions = new List<ParityDataVersion>();
        foreach (string path in Directory.EnumerateFiles(this.versionsPath, "*.meta.json"))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                ParityDataVersion? version = JsonSerializer.Deserialize<ParityDataVersion>(
                    await File.ReadAllTextAsync(path, cancellationToken),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (version is not null && File.Exists(this.VersionDocumentPath(version.Id)))
                {
                    versions.Add(version);
                }
            }
            catch (JsonException)
            {
                // Ignore incomplete metadata so one interrupted snapshot cannot hide valid versions.
            }
        }
        return versions.OrderByDescending(version => version.SavedAt).ToArray();
    }

    public async Task<ParityDataVersionDocument?> GetVersionAsync(
        string id,
        CancellationToken cancellationToken)
    {
        string safeId = SafeVersionId(id);
        string documentPath = this.VersionDocumentPath(safeId);
        string metadataPath = this.VersionMetadataPath(safeId);
        if (!File.Exists(documentPath) || !File.Exists(metadataPath))
        {
            return null;
        }

        ParityDataVersion? metadata = JsonSerializer.Deserialize<ParityDataVersion>(
            await File.ReadAllTextAsync(metadataPath, cancellationToken),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        JsonNode? document = JsonNode.Parse(await File.ReadAllTextAsync(documentPath, cancellationToken));
        if (document is not null)
        {
            EnsureValidDocument(document);
        }
        return metadata is null || document is null ? null : new(metadata, document);
    }

    public async Task<ParityDataSaveResult> SaveVersionAsync(
        ParityDataSaveRequest request,
        CancellationToken cancellationToken)
    {
        ParityDataValidationResult validation = Validate(request.Document);
        if (!validation.Valid)
        {
            return new(false, null, validation);
        }
        string normalized = request.Document!.ToJsonString(IndentedJson) + Environment.NewLine;
        await this.gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(this.activePath)!);
            Directory.CreateDirectory(this.versionsPath);

            DateTimeOffset now = DateTimeOffset.UtcNow;
            string label = string.IsNullOrWhiteSpace(request.Label) ? "Saved version" : request.Label.Trim();
            string suffix = Guid.NewGuid().ToString("N")[..12];
            string id = SafeVersionId($"{now:yyyyMMdd-HHmmss-fff}-{Slug(label)}-{suffix}");
            var version = new ParityDataVersion(
                id,
                now,
                label,
                request.Notes?.Trim() ?? string.Empty,
                request.Document!["schemaVersion"]?.GetValue<string>() ?? string.Empty,
                validation.Statistics);

            await WriteAtomicAsync(this.VersionDocumentPath(id), normalized, cancellationToken);
            await WriteAtomicAsync(
                this.VersionMetadataPath(id),
                JsonSerializer.Serialize(version, IndentedJson) + Environment.NewLine,
                cancellationToken);
            await WriteAtomicAsync(this.activePath, normalized, cancellationToken);
            this.catalog.ReplaceDocument(normalized);
            return new(true, version, validation);
        }
        finally
        {
            this.gate.Release();
        }
    }

    public async Task<ParityDataSaveResult?> RestoreVersionAsync(
        string id,
        CancellationToken cancellationToken)
    {
        ParityDataVersionDocument? version = await this.GetVersionAsync(id, cancellationToken);
        if (version is null)
        {
            return null;
        }
        return await this.SaveVersionAsync(
            new(
                version.Document,
                $"Restore: {version.Metadata.Label}",
                $"Restored from version {version.Metadata.Id}."),
            cancellationToken);
    }

    public static ParityDataValidationResult Validate(JsonNode? document)
    {
        var errors = new List<string>();
        var warnings = new List<string>();
        if (document is not JsonObject root)
        {
            return new(
                false,
                ["The parity data root must be a JSON object."],
                [],
                new Dictionary<string, int>(StringComparer.Ordinal));
        }

        string json = root.ToJsonString();
        errors.AddRange(OperationCatalog.ValidateDocument(json));

        string[] requiredArrays =
        [
            "versions", "scenarios", "layers", "functions", "fields",
            "outcomes", "errors", "enums", "entities",
        ];
        foreach (string property in requiredArrays)
        {
            if (root[property] is not JsonArray array)
            {
                errors.Add($"$.{property} must be an array.");
            }
            else if (array.Count == 0)
            {
                warnings.Add($"$.{property} is empty.");
            }
        }

        foreach (string property in requiredArrays.Where(property => property != "versions"))
        {
            ValidateUniqueIds(root[property] as JsonArray, $"$.{property}", errors);
        }

        foreach ((JsonObject scenario, int index) in IndexedObjects(root["scenarios"] as JsonArray))
        {
            string path = ItemPath("scenarios", scenario, index);
            ValidateRequiredString(scenario, "name", path, errors);
            ValidateRequiredString(scenario, "summary", path, errors);
            ValidateRequiredString(scenario, "tone", path, errors);
            if (scenario["response"] is JsonObject response)
            {
                ValidateInteger(response, "statusCode", path + ".response", errors, minimum: 100, maximum: 599);
                ValidateRequiredString(response, "version", path + ".response", errors);
                ValidateStringDictionary(response, "headers", path + ".response", errors);
                ValidateRequiredString(response, "bodyText", path + ".response", errors);
            }
            else if (scenario.ContainsKey("response") && scenario["response"] is not null)
            {
                errors.Add($"{path}.response must be an object or null.");
            }
        }

        foreach ((JsonObject outcome, int index) in IndexedObjects(root["outcomes"] as JsonArray))
        {
            string path = ItemPath("outcomes", outcome, index);
            ValidateRequiredString(outcome, "kind", path, errors);
            ValidateObject(outcome, "aliases", path, errors);
        }

        foreach ((JsonObject error, int index) in IndexedObjects(root["errors"] as JsonArray))
        {
            string path = ItemPath("errors", error, index);
            ValidateRequiredString(error, "category", path, errors);
            ValidateObject(error, "aliases", path, errors);
        }

        if (root["entities"] is JsonArray entities)
        {
            foreach ((JsonObject entity, int entityIndex) in IndexedObjects(entities))
            {
                string entityId = StringValue(entity, "id") ?? $"@{entityIndex}";
                string entityPath = $"$.entities[{entityId}]";
                ValidateRequiredString(entity, "name", entityPath, errors);
                ValidateRequiredString(entity, "icon", entityPath, errors);
                JsonArray? operations = entity["operations"] as JsonArray;
                string operationsPath = $"{entityPath}.operations";
                ValidateUniqueIds(operations, operationsPath, errors);
                if (operations is null)
                {
                    errors.Add($"{operationsPath} requires an array.");
                }
                else if (operations.Count == 0)
                {
                    warnings.Add($"{entityPath} has no operations.");
                }
                foreach ((JsonObject operation, int operationIndex) in IndexedObjects(operations))
                {
                    string operationId = StringValue(operation, "id") ?? $"@{operationIndex}";
                    string path = $"{operationsPath}[{operationId}]";
                    foreach (string property in new[] { "name", "method", "route", "responseShape", "description" })
                    {
                        ValidateRequiredString(operation, property, path, errors);
                    }
                    if (operation.ContainsKey("parameterSchema"))
                    {
                        ValidateOperationParameterSchema(operation["parameterSchema"] as JsonArray, path, errors);
                    }
                    ValidateObject(operation, "rootFunction", path, errors);
                    ValidateObject(operation, "artifact", path, errors);
                    if (operation["rootFunction"] is JsonObject rootFunction)
                    {
                        ValidateRequiredString(rootFunction, "id", path + ".rootFunction", errors);
                        ValidateRequiredString(rootFunction, "layerId", path + ".rootFunction", errors);
                        ValidateObject(rootFunction, "aliases", path + ".rootFunction", errors);
                        JsonArray? endpoints = rootFunction["endpoints"] as JsonArray;
                        ValidateNonEmptyArray(endpoints, "endpoints", path + ".rootFunction", errors);
                        ValidateSymbolEndpoints(endpoints, path + ".rootFunction", errors);
                    }
                    if (operation["artifact"] is JsonObject artifact)
                    {
                        ValidateOperationArtifact(artifact, path + ".artifact", errors);
                    }
                }
            }
        }

        var layerIds = new HashSet<string>(
            (root["layers"] as JsonArray)?.OfType<JsonObject>()
                .Select(layer => layer["id"]?.GetValue<string>())
                .OfType<string>() ?? [],
            StringComparer.Ordinal);
        foreach ((JsonObject layer, int index) in IndexedObjects(root["layers"] as JsonArray))
        {
            string path = ItemPath("layers", layer, index);
            ValidateRequiredString(layer, "name", path, errors);
            if (layer.ContainsKey("order") || layer.ContainsKey("depth") || layer.ContainsKey("phase"))
            {
                errors.Add($"{path} order, depth, and phase are not supported in schema 1.0; array position defines layer placement.");
            }
        }
        int serviceBoundaryCount = 0;
        foreach ((JsonObject function, int index) in IndexedObjects(root["functions"] as JsonArray))
        {
            string path = ItemPath("functions", function, index);
            ValidateRequiredString(function, "layerId", path, errors);
            ValidateLayerReference(function, path, layerIds, errors);
            ValidateEnumString(function, "role", path, ["step", "serviceBoundary"], errors);
            if (StringValue(function, "role") == "serviceBoundary")
            {
                serviceBoundaryCount++;
            }
            JsonArray? endpoints = function["endpoints"] as JsonArray;
            ValidateNonEmptyArray(endpoints, "endpoints", path, errors);
            ValidateSymbolEndpoints(endpoints, path, errors);
        }
        if (serviceBoundaryCount != 1)
        {
            errors.Add($"$.functions requires exactly one serviceBoundary role; found {serviceBoundaryCount}.");
        }
        var fieldEndpointOwners = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach ((JsonObject field, int index) in IndexedObjects(root["fields"] as JsonArray))
        {
            string path = ItemPath("fields", field, index);
            bool excluded = false;
            if (field["excluded"] is not JsonValue fieldExcluded
                || !fieldExcluded.TryGetValue<bool>(out excluded))
            {
                errors.Add($"{path}.excluded requires a boolean.");
            }
            JsonArray? fieldEndpoints = field["endpoints"] as JsonArray;
            if (fieldEndpoints is null)
            {
                errors.Add($"{path}.endpoints requires an array.");
            }
            else if (fieldEndpoints.Count == 0)
            {
                ValidateDefaultFieldAliases(field, path, errors);
                if (excluded)
                {
                    errors.Add($"{path}.endpoints requires at least one mapping when excluded is true.");
                }
            }
            else if (!excluded)
            {
                HashSet<string> runtimeIds = fieldEndpoints.OfType<JsonObject>()
                    .Select(endpoint => StringValue(endpoint, "runtimeId"))
                    .Where(runtimeId => runtimeId is not null)
                    .Select(runtimeId => runtimeId!)
                    .ToHashSet(StringComparer.Ordinal);
                if (!runtimeIds.SetEquals(["csharp", "rust"]))
                {
                    errors.Add($"{path}.endpoints must map both csharp and rust unless excluded is true.");
                }
            }
            foreach (JsonObject endpoint in fieldEndpoints?.OfType<JsonObject>() ?? [])
            {
                ValidateRequiredString(endpoint, "runtimeId", path, errors);
                ValidateRequiredString(endpoint, "scope", path, errors);
                ValidateRequiredString(endpoint, "ownerTypeSymbol", path, errors);
                ValidateRequiredString(endpoint, "memberPath", path, errors);
                string? scope = endpoint["scope"]?.GetValue<string>();
                if (scope == "function")
                {
                    ValidateRequiredString(endpoint, "functionSymbol", path, errors);
                    ValidateRequiredString(endpoint, "path", path, errors);
                    string? direction = endpoint["direction"]?.GetValue<string>();
                    if (direction is not ("input" or "output"))
                    {
                        errors.Add($"{path} function endpoint direction must be 'input' or 'output'.");
                    }
                }
                else if (scope != "type")
                {
                    errors.Add($"{path} endpoint scope must be 'type' or 'function'.");
                }

                string? endpointKey = FieldEndpointKey(endpoint);
                if (endpointKey is not null
                    && fieldEndpointOwners.TryGetValue(endpointKey, out string? existingPath))
                {
                    errors.Add($"{path}.endpoints reuses canonical field endpoint from {existingPath}.");
                }
                else if (endpointKey is not null)
                {
                    fieldEndpointOwners[endpointKey] = path;
                }
            }
        }
        var enumTypeSymbols = new HashSet<string>(StringComparer.Ordinal);
        var enumMemberSymbols = new HashSet<string>(StringComparer.Ordinal);
        foreach ((JsonObject enumPairing, int index) in IndexedObjects(root["enums"] as JsonArray))
        {
            string path = ItemPath("enums", enumPairing, index);
            JsonArray? endpoints = enumPairing["endpoints"] as JsonArray;
            ValidateNonEmptyArray(endpoints, "endpoints", path, errors);
            ValidateSymbolEndpoints(endpoints, path, errors);
            var endpointRuntimeIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonObject endpoint in endpoints?.OfType<JsonObject>() ?? [])
            {
                string? runtimeId = endpoint["runtimeId"]?.GetValue<string>();
                string? symbol = endpoint["symbol"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(runtimeId) && !endpointRuntimeIds.Add(runtimeId))
                {
                    errors.Add($"{path}.endpoints contains more than one {runtimeId} enum type symbol.");
                }
                if (!string.IsNullOrWhiteSpace(runtimeId) && !string.IsNullOrWhiteSpace(symbol)
                    && !enumTypeSymbols.Add($"{runtimeId}\0{symbol}"))
                {
                    errors.Add($"{path}.endpoints reuses {runtimeId} enum type symbol '{symbol}'.");
                }
            }
            if (enumPairing.ContainsKey("values"))
            {
                errors.Add($"{path}.values is not supported in schema 1.0; enum values come from trace annotations.");
            }
            var pairingNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonObject member in (enumPairing["members"] as JsonArray)?.OfType<JsonObject>() ?? [])
            {
                if (member.ContainsKey("id"))
                {
                    errors.Add($"{path}.members.id is not supported; exact runtime symbols define the pairing.");
                }
                if (member["symbols"] is not JsonObject symbols || symbols.Count == 0
                    || symbols.Any(symbol => symbol.Value is not JsonValue value
                        || !value.TryGetValue<string>(out string? text)
                        || string.IsNullOrWhiteSpace(text)))
                {
                    errors.Add($"{path}.members items must contain exact runtime symbols.");
                    continue;
                }
                string pairingName = EnumMemberName(symbols);
                if (!pairingNames.Add(pairingName))
                {
                    errors.Add($"{path}.members contains duplicate normalized member pairing '{pairingName}'.");
                }
                foreach ((string runtimeId, JsonNode? value) in symbols)
                {
                    string symbol = value!.GetValue<string>();
                    if (!enumMemberSymbols.Add($"{runtimeId}\0{symbol}"))
                    {
                        errors.Add($"{path}.members reuses {runtimeId} member symbol '{symbol}'.");
                    }
                }
            }
        }
        foreach (JsonObject entity in (root["entities"] as JsonArray)?.OfType<JsonObject>() ?? [])
        {
            foreach (JsonObject operation in (entity["operations"] as JsonArray)?.OfType<JsonObject>() ?? [])
            {
                if (operation["rootFunction"] is JsonObject rootFunction)
                {
                    ValidateLayerReference(
                        rootFunction,
                        $"$.entities[{entity["id"]}].operations[{operation["id"]}].rootFunction",
                        layerIds,
                        errors);
                }
            }
        }

        return new(errors.Count == 0, errors.Distinct().ToArray(), warnings.Distinct().ToArray(), GetStatistics(root));
    }

    private static void EnsureValidDocument(JsonNode document)
    {
        ParityDataValidationResult validation = Validate(document);
        if (!validation.Valid)
        {
            throw new InvalidOperationException(string.Join(Environment.NewLine, validation.Errors));
        }
    }

    private static string EnumMemberName(JsonObject symbols)
    {
        string symbol = symbols
            .OrderBy(item => item.Key == "csharp" ? 0 : item.Key == "rust" ? 1 : 2)
            .ThenBy(item => item.Key, StringComparer.Ordinal)
            .Select(item => item.Value!.GetValue<string>())
            .First();
        int rustSeparator = symbol.LastIndexOf("::", StringComparison.Ordinal);
        int separator = Math.Max(symbol.LastIndexOf('.'), rustSeparator < 0 ? -1 : rustSeparator + 1);
        return symbol[(separator + 1)..];
    }

    private static void ValidateUniqueIds(JsonArray? items, string path, List<string> errors)
    {
        if (items is null)
        {
            return;
        }
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach ((JsonObject item, int index) in IndexedObjects(items))
        {
            string? id = StringValue(item, "id");
            if (string.IsNullOrWhiteSpace(id))
            {
                errors.Add($"{path}[@{index}].id requires a non-empty value.");
            }
            else if (!ids.Add(id))
            {
                errors.Add($"{path}[@{index}].id duplicates '{id}'.");
            }
        }
    }

    private static IEnumerable<(JsonObject Item, int Index)> IndexedObjects(JsonArray? items)
    {
        if (items is null)
        {
            yield break;
        }
        for (int index = 0; index < items.Count; index++)
        {
            if (items[index] is JsonObject item)
            {
                yield return (item, index);
            }
        }
    }

    private static string ItemPath(string collection, JsonObject item, int index) =>
        $"$.{collection}[{StringValue(item, "id") ?? $"@{index}"}]";

    private static string? StringValue(JsonObject item, string property) =>
        item[property] is JsonValue value
        && value.TryGetValue<string>(out string? text)
        && !string.IsNullOrWhiteSpace(text)
            ? text
            : null;

    private static string? FieldEndpointKey(JsonObject endpoint)
    {
        string? runtimeId = StringValue(endpoint, "runtimeId");
        string? scope = StringValue(endpoint, "scope");
        string? ownerTypeSymbol = StringValue(endpoint, "ownerTypeSymbol");
        string? memberPath = StringValue(endpoint, "memberPath");
        if (runtimeId is null || scope is null || ownerTypeSymbol is null || memberPath is null)
        {
            return null;
        }

        return scope == "function"
            ? string.Join('\0', runtimeId, scope, StringValue(endpoint, "functionSymbol"),
                StringValue(endpoint, "direction"),
                FieldPathStandardizer.NormalizePath(StringValue(endpoint, "path") ?? string.Empty))
            : string.Join('\0', runtimeId, scope, ownerTypeSymbol,
                FieldPathStandardizer.NormalizePath(memberPath));
    }

    private static void ValidateLayerReference(
        JsonObject item,
        string path,
        HashSet<string> layerIds,
        List<string> errors)
    {
        string? layerId = item["layerId"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(layerId) && !layerIds.Contains(layerId))
        {
            errors.Add($"{path} item '{item["id"]}' references unknown layer '{layerId}'.");
        }
    }

    private static void ValidateSymbolEndpoints(JsonArray? endpoints, string path, List<string> errors)
    {
        foreach (JsonObject endpoint in endpoints?.OfType<JsonObject>() ?? [])
        {
            ValidateRequiredString(endpoint, "runtimeId", path, errors);
            ValidateRequiredString(endpoint, "symbol", path, errors);
        }
    }

    private static void ValidateRequiredString(
        JsonObject item,
        string property,
        string path,
        List<string> errors)
    {
        if (item[property] is not JsonValue value
            || !value.TryGetValue<string>(out string? text)
            || string.IsNullOrWhiteSpace(text))
        {
            errors.Add($"{path} requires a non-empty {property}.");
        }
    }

    private static void ValidateObject(JsonObject item, string property, string path, List<string> errors)
    {
        if (item[property] is not JsonObject)
        {
            errors.Add($"{path}.{property} requires an object.");
        }
    }

    private static void ValidateDefaultFieldAliases(JsonObject field, string path, List<string> errors)
    {
        if (field["aliases"] is not JsonObject aliases
            || new[] { "csharp", "rust" }.Any(runtimeId =>
                aliases[runtimeId] is not JsonArray values
                || values.Count == 0
                || values.Any(value => value is not JsonValue item
                    || !item.TryGetValue<string>(out string? text)
                    || string.IsNullOrWhiteSpace(text))))
        {
            errors.Add($"{path} default-mapped field requires non-empty C# and Rust aliases.");
        }
    }

    private static void ValidateEnumString(
        JsonObject item,
        string property,
        string path,
        string[] allowed,
        List<string> errors)
    {
        string? value = StringValue(item, property);
        if (value is null || !allowed.Contains(value))
        {
            errors.Add($"{path}.{property} must be one of: {string.Join(", ", allowed)}.");
        }
    }

    private static void ValidateNonEmptyArray(JsonArray? value, string property, string path, List<string> errors)
    {
        if (value is null || value.Count == 0)
        {
            errors.Add($"{path}.{property} requires at least one item.");
        }
    }

    private static void ValidateInteger(
        JsonObject item,
        string property,
        string path,
        List<string> errors,
        int? minimum = null,
        int? maximum = null)
    {
        if (item[property] is not JsonValue value || !value.TryGetValue<int>(out int number))
        {
            errors.Add($"{path}.{property} requires an integer.");
        }
        else if (minimum.HasValue && number < minimum.Value)
        {
            errors.Add($"{path}.{property} must be at least {minimum.Value}.");
        }
        else if (maximum.HasValue && number > maximum.Value)
        {
            errors.Add($"{path}.{property} must be at most {maximum.Value}.");
        }
    }

    private static void ValidateStringDictionary(
        JsonObject item,
        string property,
        string path,
        List<string> errors)
    {
        if (item[property] is not JsonObject values)
        {
            errors.Add($"{path}.{property} requires an object.");
            return;
        }
        foreach ((string name, JsonNode? value) in values)
        {
            if (string.IsNullOrWhiteSpace(name)
                || value is not JsonValue jsonValue
                || !jsonValue.TryGetValue<string>(out _))
            {
                errors.Add($"{path}.{property} must contain string header names and values.");
                return;
            }
        }
    }

    private static void ValidateOperationArtifact(JsonObject artifact, string path, List<string> errors)
    {
        if (artifact["invocation"] is JsonObject invocation)
        {
            ValidateRequiredString(invocation, "tenant", path + ".invocation", errors);
            ValidateRequiredString(invocation, "token", path + ".invocation", errors);
            ValidateObject(invocation, "arguments", path + ".invocation", errors);
            ValidateOptionalStringArray(invocation, "querySelect", path + ".invocation", errors);
            ValidateOptionalStringArray(invocation, "queryOrderBy", path + ".invocation", errors);
        }
        else
        {
            errors.Add($"{path}.invocation requires an object.");
        }

        if (artifact["request"] is JsonObject request)
        {
            ValidateRequiredString(request, "method", path + ".request", errors);
            ValidateRequiredString(request, "pathContains", path + ".request", errors);
            if (request.ContainsKey("pathAliases"))
            {
                ValidateStringDictionary(request, "pathAliases", path + ".request", errors);
            }
            if (request.ContainsKey("headers"))
            {
                ValidateStringDictionary(request, "headers", path + ".request", errors);
            }
        }
        else
        {
            errors.Add($"{path}.request requires an object.");
        }

        if (artifact["response"] is JsonObject response)
        {
            ValidateInteger(response, "statusCode", path + ".response", errors, minimum: 100, maximum: 599);
            ValidateRequiredString(response, "version", path + ".response", errors);
            if (response.ContainsKey("headers"))
            {
                ValidateStringDictionary(response, "headers", path + ".response", errors);
            }
        }
        else
        {
            errors.Add($"{path}.response requires an object.");
        }
    }

    private static void ValidateOperationParameterSchema(JsonArray? parameters, string path, List<string> errors)
    {
        string[] invocationSources =
        [
            "tenant", "token", "keyKind", "key", "queryFilter", "queryPropertySet",
            "queryTop", "querySkip", "queryExpand", "querySelect", "queryOrderBy",
        ];
        if (parameters is null)
        {
            errors.Add($"{path}.parameterSchema requires an array.");
            return;
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        var sources = new HashSet<string>(StringComparer.Ordinal);
        foreach ((JsonObject parameter, int index) in IndexedObjects(parameters))
        {
            string parameterPath = $"{path}.parameterSchema[{index}]";
            foreach (string property in new[] { "id", "label", "source", "kind" })
            {
                ValidateRequiredString(parameter, property, parameterPath, errors);
            }
            ValidateEnumString(
                parameter,
                "kind",
                parameterPath,
                ["string", "secret", "integer", "boolean", "string-list"],
                errors);

            string? id = StringValue(parameter, "id");
            string? source = StringValue(parameter, "source");
            if (id is not null && !ids.Add(id))
            {
                errors.Add($"{path}.parameterSchema reuses parameter id '{id}'.");
            }
            if (source is not null && !sources.Add(source))
            {
                errors.Add($"{path}.parameterSchema reuses parameter source '{source}'.");
            }
            if (source is not null
                && !invocationSources.Contains(source, StringComparer.Ordinal)
                && !source.StartsWith("arguments.", StringComparison.Ordinal))
            {
                errors.Add($"{parameterPath}.source must name a supported invocation field or arguments entry.");
            }
            if (parameter["required"] is not JsonValue required || !required.TryGetValue<bool>(out _))
            {
                errors.Add($"{parameterPath}.required requires a boolean.");
            }
        }
    }

    private static void ValidateOptionalStringArray(JsonObject item, string property, string path, List<string> errors)
    {
        if (!item.ContainsKey(property))
        {
            return;
        }
        if (item[property] is not JsonArray values
            || values.Any(value => value is not JsonValue jsonValue || !jsonValue.TryGetValue<string>(out _)))
        {
            errors.Add($"{path}.{property} must contain only strings.");
        }
    }

    private static Dictionary<string, int> GetStatistics(JsonNode document)
    {
        var statistics = new Dictionary<string, int>(StringComparer.Ordinal);
        if (document is not JsonObject root)
        {
            return statistics;
        }
        foreach ((string name, JsonNode? value) in root)
        {
            if (value is JsonArray array)
            {
                statistics[name] = array.Count;
            }
        }
        statistics["operations"] = (root["entities"] as JsonArray)?.OfType<JsonObject>()
            .Sum(entity => (entity["operations"] as JsonArray)?.Count ?? 0) ?? 0;
        return statistics;
    }

    private string VersionDocumentPath(string id) => Path.Combine(this.versionsPath, $"{id}.json");

    private string VersionMetadataPath(string id) => Path.Combine(this.versionsPath, $"{id}.meta.json");

    private static string SafeVersionId(string id)
    {
        string safe = Regex.Replace(id, "[^a-zA-Z0-9._-]", "-");
        if (string.IsNullOrWhiteSpace(safe) || safe.Contains("..", StringComparison.Ordinal))
        {
            throw new ArgumentException("Invalid parity data version ID.", nameof(id));
        }
        return safe;
    }

    private static string Slug(string value)
    {
        string slug = Regex.Replace(value.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrEmpty(slug) ? "version" : slug[..Math.Min(slug.Length, 28)];
    }

    private static async Task WriteAtomicAsync(
        string path,
        string content,
        CancellationToken cancellationToken)
    {
        string temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await File.WriteAllTextAsync(temporaryPath, content, cancellationToken);
            File.Move(temporaryPath, path, true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }
}

public sealed record ParityDataWorkspace(
    JsonNode Document,
    IReadOnlyList<ParityDataVersion> Versions,
    IReadOnlyDictionary<string, int> Statistics);

public sealed record ParityDataVersion(
    string Id,
    DateTimeOffset SavedAt,
    string Label,
    string Notes,
    string SchemaVersion,
    IReadOnlyDictionary<string, int> Statistics);

public sealed record ParityDataVersionDocument(ParityDataVersion Metadata, JsonNode Document);

public sealed record ParityDataSaveRequest(JsonNode? Document, string? Label, string? Notes);

public sealed record ParityDataSaveResult(
    bool Saved,
    ParityDataVersion? Version,
    ParityDataValidationResult Validation);

public sealed record ParityDataHotloadResult(
    bool Loaded,
    ParityDataValidationResult Validation);

public sealed record ParityDataValidationResult(
    bool Valid,
    IReadOnlyList<string> Errors,
    IReadOnlyList<string> Warnings,
    IReadOnlyDictionary<string, int> Statistics);
