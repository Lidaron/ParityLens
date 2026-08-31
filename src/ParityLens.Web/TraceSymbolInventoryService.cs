namespace ParityLens.Web;

using System.Text.Json.Nodes;

public sealed class TraceSymbolInventoryService(ComparisonSimulator simulator)
{
    public JsonObject GetInventory()
    {
        var functions = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var fields = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var enums = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        ComparisonRun[] runs = simulator.GetRecentRuns().ToArray();

        foreach (ComparisonRun run in runs)
        {
            foreach (TracePair pair in run.Trace)
            {
                CaptureStep(run, "baseline", pair.Baseline, functions, fields, enums);
                CaptureStep(run, "candidate", pair.Candidate, functions, fields, enums);
            }
        }

        return new JsonObject
        {
            ["runs"] = new JsonArray(runs.Select(run => new JsonObject
            {
                ["id"] = run.Id,
                ["label"] = $"{run.EntityName} / {run.OperationName}",
                ["startedAt"] = run.StartedAt,
            }).ToArray()),
            ["functions"] = new JsonArray(functions.Values
                .OrderBy(item => item["runtimeId"]?.GetValue<string>(), StringComparer.Ordinal)
                .ThenBy(item => item["symbol"]?.GetValue<string>(), StringComparer.Ordinal)
                .ToArray()),
            ["fields"] = new JsonArray(fields.Values
                .OrderBy(item => item["runtimeId"]?.GetValue<string>(), StringComparer.Ordinal)
                .ThenBy(item => item["functionSymbol"]?.GetValue<string>(), StringComparer.Ordinal)
                .ThenBy(item => item["direction"]?.GetValue<string>(), StringComparer.Ordinal)
                .ThenBy(item => item["path"]?.GetValue<string>(), StringComparer.Ordinal)
                .ToArray()),
            ["enums"] = new JsonArray(enums.Values
                .OrderBy(item => item["runtimeId"]?.GetValue<string>(), StringComparer.Ordinal)
                .ThenBy(item => item["symbol"]?.GetValue<string>(), StringComparer.Ordinal)
                .ToArray()),
        };
    }

    private static void CaptureStep(
        ComparisonRun run,
        string side,
        TraceStep? step,
        Dictionary<string, JsonObject> functions,
        Dictionary<string, JsonObject> fields,
        Dictionary<string, JsonObject> enums)
    {
        if (step is null)
        {
            return;
        }

        string runtime = step.Data["runtime"]?.GetValue<string>() ?? side;
        string runtimeId = runtime.StartsWith("C#", StringComparison.OrdinalIgnoreCase)
            || runtime.Equals("csharp", StringComparison.OrdinalIgnoreCase) ? "csharp" : "rust";
        string functionSymbol = step.Data["symbols"]?["functionSymbol"]?.GetValue<string>() ?? step.Function;
        string functionId = step.Data["functionId"]?.GetValue<string>() ?? step.Id;
        string functionKey = string.Join('|', runtimeId, functionSymbol, functionId);
        if (!functions.ContainsKey(functionKey))
        {
            functions[functionKey] = new JsonObject
            {
                ["runtimeId"] = runtimeId,
                ["symbol"] = functionSymbol,
                ["functionId"] = functionId,
                ["layerId"] = step.Data["layerId"]?.DeepClone(),
                ["runId"] = run.Id,
                ["side"] = side,
                ["parameters"] = step.Data["symbols"]?["parameters"]?.DeepClone() ?? new JsonArray(),
                ["outputTypeSymbol"] = step.Data["symbols"]?["outputTypeSymbol"]?.DeepClone(),
            };
        }

        CaptureDirection(
            run,
            side,
            runtimeId,
            functionSymbol,
            "input",
            step.Data["rawInput"],
            step.Data["symbols"],
            step.Data["inputFieldIds"] as JsonObject,
            step.Data["inputPaths"] as JsonObject,
            fields,
            enums);
        CaptureDirection(
            run,
            side,
            runtimeId,
            functionSymbol,
            "output",
            step.Data["rawOutput"],
            step.Data["symbols"],
            step.Data["outputFieldIds"] as JsonObject,
            step.Data["outputPaths"] as JsonObject,
            fields,
            enums);
    }

    private static void CaptureDirection(
        ComparisonRun run,
        string side,
        string runtimeId,
        string functionSymbol,
        string direction,
        JsonNode? value,
        JsonNode? symbols,
        JsonObject? fieldIds,
        JsonObject? runtimePaths,
        Dictionary<string, JsonObject> fields,
        Dictionary<string, JsonObject> enums)
    {
        string rootType = direction == "output"
            ? symbols?["outputTypeSymbol"]?.GetValue<string>() ?? string.Empty
            : string.Empty;
        Walk(
            value,
            "$",
            rootType,
            direction,
            run.Id,
            side,
            runtimeId,
            functionSymbol,
            symbols,
            fieldIds,
            runtimePaths,
            fields,
            enums);
    }

    private static void Walk(
        JsonNode? value,
        string path,
        string rootType,
        string direction,
        string runId,
        string side,
        string runtimeId,
        string functionSymbol,
        JsonNode? symbols,
        JsonObject? fieldIds,
        JsonObject? runtimePaths,
        Dictionary<string, JsonObject> fields,
        Dictionary<string, JsonObject> enums)
    {
        if (value is JsonObject objectValue)
        {
            CaptureEnum(objectValue, runtimeId, functionSymbol, runId, enums);
            foreach ((string name, JsonNode? child) in objectValue)
            {
                string childPath = path + "[\"" + name.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"]";
                RuntimeFieldIdentity identity = RuntimeFieldIdentityResolver.Resolve(symbols, direction, childPath);
                AddField(
                    child,
                    childPath,
                    identity,
                    direction,
                    runId,
                    side,
                    runtimeId,
                    functionSymbol,
                    ResolveFieldId(childPath, fieldIds, runtimePaths),
                    fields);
                RuntimeFieldIdentity? valueRoot = RuntimeFieldIdentityResolver.ResolveValueRoot(
                    symbols,
                    direction,
                    childPath);
                if (child is JsonObject or JsonArray && valueRoot is not null)
                {
                    AddField(
                        child,
                        childPath,
                        valueRoot,
                        direction,
                        runId,
                        side,
                        runtimeId,
                        functionSymbol,
                        ResolveFieldId(childPath, fieldIds, runtimePaths),
                        fields);
                }
                Walk(
                    child,
                    childPath,
                    identity.OwnerTypeSymbol,
                    direction,
                    runId,
                    side,
                    runtimeId,
                    functionSymbol,
                    symbols,
                    fieldIds,
                    runtimePaths,
                    fields,
                    enums);
            }
            return;
        }

        if (value is JsonArray array)
        {
            foreach (JsonNode? child in array)
            {
                Walk(
                    child,
                    path + "[*]",
                    rootType,
                    direction,
                    runId,
                    side,
                    runtimeId,
                    functionSymbol,
                    symbols,
                    fieldIds,
                    runtimePaths,
                    fields,
                    enums);
            }
        }
    }

    private static void AddField(
        JsonNode? value,
        string path,
        RuntimeFieldIdentity identity,
        string direction,
        string runId,
        string side,
        string runtimeId,
        string functionSymbol,
        string? fieldId,
        Dictionary<string, JsonObject> fields)
    {
        string key = identity.Scope == "type"
            ? string.Join('|', runtimeId, identity.Scope, identity.OwnerTypeSymbol,
                FieldPathStandardizer.NormalizePath(identity.MemberPath))
            : string.Join('|', runtimeId, identity.Scope, functionSymbol, direction,
                FieldPathStandardizer.NormalizePath(path));
        if (fields.ContainsKey(key))
        {
            return;
        }
        fields[key] = new JsonObject
        {
            ["runtimeId"] = runtimeId,
            ["scope"] = identity.Scope,
            ["functionSymbol"] = functionSymbol,
            ["fieldId"] = fieldId,
            ["direction"] = direction,
            ["ownerTypeSymbol"] = identity.OwnerTypeSymbol,
            ["memberPath"] = identity.MemberPath,
            ["path"] = path,
            ["valueKind"] = ValueKind(value),
            ["sample"] = value is JsonValue ? value.DeepClone() : null,
            ["runId"] = runId,
            ["side"] = side,
        };
    }

    private static string? ResolveFieldId(
        string observedPath,
        JsonObject? fieldIds,
        JsonObject? runtimePaths)
    {
        if (fieldIds is null || runtimePaths is null)
        {
            return null;
        }

        foreach ((string canonicalPath, JsonNode? fieldId) in fieldIds)
        {
            string path = canonicalPath;
            if (runtimePaths[canonicalPath] is JsonValue runtimePath
                && runtimePath.TryGetValue<string>(out string? explicitPath))
            {
                path = explicitPath;
            }
            if (FieldPathStandardizer.AreEquivalent(ToObservedPath(path), observedPath))
            {
                return fieldId?.GetValue<string>();
            }
        }
        return null;
    }

    private static string ToObservedPath(string path)
    {
        if (path == "$")
        {
            return path;
        }

        var result = new System.Text.StringBuilder("$");
        int index = 1;
        while (index < path.Length)
        {
            if (path[index] == '.')
            {
                int start = ++index;
                while (index < path.Length && path[index] is not ('.' or '['))
                {
                    index++;
                }
                result.Append("[\"").Append(path.AsSpan(start, index - start)).Append("\"]");
            }
            else if (path[index] == '[')
            {
                int close = path.IndexOf(']', index);
                if (close < 0)
                {
                    break;
                }
                result.Append("[*]");
                index = close + 1;
            }
            else
            {
                index++;
            }
        }
        return result.ToString();
    }

    private static void CaptureEnum(
        JsonObject value,
        string runtimeId,
        string functionSymbol,
        string runId,
        Dictionary<string, JsonObject> enums)
    {
        string? symbol = value["enum_symbol"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(symbol))
        {
            return;
        }
        string key = runtimeId + "|" + symbol;
        if (enums.ContainsKey(key))
        {
            return;
        }
        enums[key] = new JsonObject
        {
            ["runtimeId"] = runtimeId,
            ["symbol"] = symbol,
            ["flags"] = value["enum_flags"]?.DeepClone() ?? false,
            ["members"] = value["enum_members"]?.DeepClone() ?? new JsonArray(),
            ["functionSymbol"] = functionSymbol,
            ["runId"] = runId,
        };
    }

    private static string ValueKind(JsonNode? value) => value switch
    {
        null => "null",
        JsonObject => "object",
        JsonArray => "array",
        JsonValue jsonValue when jsonValue.TryGetValue<bool>(out _) => "boolean",
        JsonValue jsonValue when jsonValue.TryGetValue<long>(out _) => "integer",
        JsonValue jsonValue when jsonValue.TryGetValue<double>(out _) => "number",
        _ => "string",
    };
}
