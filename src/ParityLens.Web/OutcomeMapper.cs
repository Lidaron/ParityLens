namespace ParityLens.Web;

using System.Net;
using System.Text.Json.Nodes;

public static class OutcomeMapper
{
    public static CanonicalOutcome Map(
        JsonNode? output,
        bool completedSuccessfully,
        string runtime,
        IReadOnlyList<OutcomePairingDefinition> outcomes,
        IReadOnlyList<ErrorPairingDefinition> errors)
    {
        string runtimeId = runtime.StartsWith("C#", StringComparison.Ordinal) ? "csharp" : "rust";
        JsonNode? value = output;
        JsonNode? error = null;
        string? outcomeAlias = null;
        int? statusCode = null;
        bool? diagnosticSuccess = null;

        if (output is JsonObject objectValue)
        {
            if (TryProperty(objectValue, "Ok", out JsonNode? okValue))
            {
                outcomeAlias = "Ok";
                value = okValue;
            }
            else if (TryProperty(objectValue, "Err", out JsonNode? errValue))
            {
                outcomeAlias = "Err";
                error = errValue;
                value = null;
            }
            else if (objectValue["diagnostic.info"] is JsonObject diagnostic)
            {
                diagnosticSuccess = ReadBoolean(diagnostic["diagnostic.success"]);
                statusCode = ReadStatusCode(diagnostic["diagnostic.status-code"])
                    ?? ReadStatusCode(diagnostic["diagnostic.http-response"]?["diagnostic.status-code"]);
                error = diagnostic["diagnostic.error"] ?? Property(diagnostic, "exception");
                if (error is null && diagnosticSuccess == false)
                {
                    error = new JsonObject
                    {
                        ["message"] = ReadString(diagnostic["diagnostic.error-detail"]),
                        ["status_code"] = statusCode,
                    };
                }
                value = objectValue["response.value"];
                outcomeAlias = statusCode == (int)HttpStatusCode.NotFound && value is null
                    ? "diagnostic-not-found"
                    : diagnosticSuccess == true
                        ? value is null ? "diagnostic-not-found" : "diagnostic-success"
                        : "diagnostic-failure";
            }
            else if (LooksLikeException(objectValue))
            {
                outcomeAlias = "throw";
                error = objectValue;
                value = null;
                statusCode = ReadStatusCode(Property(objectValue, "status_code"))
                    ?? ReadStatusCode(Property(objectValue, "http_status"));
            }
        }

        outcomeAlias ??= completedSuccessfully
            ? value is null ? "return-null" : "return"
            : runtimeId == "rust" ? "Err" : "throw";

        OutcomePairingDefinition outcomeDefinition = outcomes.FirstOrDefault(definition =>
            definition.Aliases.TryGetValue(runtimeId, out IReadOnlyList<string>? aliases)
            && aliases.Contains(outcomeAlias, StringComparer.Ordinal))
            ?? outcomes.First(definition => definition.Id == (completedSuccessfully ? "outcome.ok" : "outcome.err"));

        bool diagnosticAbsence = outcomeAlias == "diagnostic-not-found";
        if (outcomeDefinition.Kind == "failure"
            || (!completedSuccessfully && !diagnosticAbsence)
            || (diagnosticSuccess == false && !diagnosticAbsence))
        {
            CanonicalError canonicalError = MapError(error, statusCode, runtimeId, errors);
            return new CanonicalOutcome("outcome.err", "failure", "none", canonicalError);
        }

        string valueState = value is null ? "absent" : "value";
        string outcomeId = value is null ? "outcome.absent" : outcomeDefinition.Id;
        string kind = value is null ? "absence" : outcomeDefinition.Kind;
        return new CanonicalOutcome(outcomeId, kind, valueState, null);
    }

    private static CanonicalError MapError(
        JsonNode? error,
        int? fallbackStatusCode,
        string runtimeId,
        IReadOnlyList<ErrorPairingDefinition> errors)
    {
        JsonObject? objectValue = error as JsonObject;
        string? runtimeType = ReadString(Property(objectValue, "exception_type"))
            ?? ReadString(Property(objectValue, "type"))
            ?? ReadString(Property(objectValue, "kind"));
        int? statusCode = ReadStatusCode(Property(objectValue, "status_code")) ?? fallbackStatusCode;
        bool? retryable = ReadBoolean(Property(objectValue, "is_retryable"));
        string? message = ReadString(Property(objectValue, "message"))
            ?? ReadString(Property(objectValue, "error_message"))
            ?? (error is JsonValue value ? value.ToJsonString() : null);

        ErrorPairingDefinition definition = errors.FirstOrDefault(candidate =>
            runtimeType is not null
            && candidate.Aliases.TryGetValue(runtimeId, out IReadOnlyList<string>? aliases)
            && aliases.Any(alias => runtimeType.Equals(alias, StringComparison.OrdinalIgnoreCase)
                || runtimeType.EndsWith($".{alias}", StringComparison.OrdinalIgnoreCase))
            && (candidate.StatusCode is null || statusCode is null || candidate.StatusCode == statusCode))
            ?? errors.FirstOrDefault(candidate => candidate.StatusCode == statusCode)
            ?? errors.First(candidate => candidate.Id == "error.unknown");

        return new CanonicalError(
            definition.Id,
            definition.Category,
            statusCode ?? definition.StatusCode,
            retryable ?? definition.Retryable,
            message,
            runtimeType);
    }

    private static bool TryProperty(JsonObject value, string name, out JsonNode? result)
    {
        KeyValuePair<string, JsonNode?> pair = value.FirstOrDefault(property =>
            property.Key.Equals(name, StringComparison.OrdinalIgnoreCase)
            || property.Key.Equals($"json:{name}", StringComparison.OrdinalIgnoreCase));
        result = pair.Value;
        return pair.Key is not null;
    }

    private static JsonNode? Property(JsonObject? value, string name) =>
        value is not null && TryProperty(value, name, out JsonNode? result) ? result : null;

    private static bool LooksLikeException(JsonObject value) =>
        Property(value, "exception_type") is not null
        || Property(value, "error_message") is not null
        || Property(value, "is_client_error") is not null
        || Property(value, "is_server_error") is not null;

    private static bool? ReadBoolean(JsonNode? value) =>
        value is JsonValue jsonValue && jsonValue.TryGetValue<bool>(out bool boolean) ? boolean : null;

    private static int? ReadStatusCode(JsonNode? value)
    {
        if (value is JsonValue jsonValue && jsonValue.TryGetValue<int>(out int numeric))
        {
            return numeric;
        }
        string? text = ReadString(value);
        if (int.TryParse(text, out int parsed))
        {
            return parsed;
        }
        return Enum.TryParse(text, ignoreCase: true, out HttpStatusCode status)
            ? (int)status
            : null;
    }

    private static string? ReadString(JsonNode? value) =>
        value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out string? text) ? text : null;
}
