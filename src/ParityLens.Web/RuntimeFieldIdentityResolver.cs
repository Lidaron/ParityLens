namespace ParityLens.Web;

using System.Text.Json;
using System.Text.Json.Nodes;

internal sealed record RuntimeFieldIdentity(
    string Scope,
    string OwnerTypeSymbol,
    string MemberPath);

internal static class RuntimeFieldIdentityResolver
{
    public static RuntimeFieldIdentity? ResolveValueRoot(
        JsonNode? symbols,
        string direction,
        string path)
    {
        JsonObject? field = AnnotatedFields(symbols, direction).FirstOrDefault(candidate =>
            ObservedPath(candidate) is string fieldPath
            && FieldPathStandardizer.AreEquivalent(fieldPath, path));
        string owner = NormalizeOwnerType(field?["valueTypeSymbol"]?.GetValue<string>() ?? string.Empty);
        return IsStableOwner(owner) ? new RuntimeFieldIdentity("type", owner, "$") : null;
    }

    public static RuntimeFieldIdentity Resolve(
        JsonNode? symbols,
        string direction,
        string path,
        string? fallbackOwnerType = null,
        string fallbackRootPath = "$")
    {
        IEnumerable<JsonObject> annotatedFields = AnnotatedFields(symbols, direction);
        JsonObject? exactField = annotatedFields.FirstOrDefault(field =>
            ObservedPath(field) is string fieldPath
            && FieldPathStandardizer.AreEquivalent(fieldPath, path));
        if (exactField?["ownerTypeSymbol"] is JsonValue exactOwner
            && exactOwner.TryGetValue<string>(out string? exactOwnerType)
            && !string.IsNullOrWhiteSpace(exactOwnerType))
        {
            string owner = NormalizeOwnerType(exactOwnerType);
            string symbolPath = exactField["path"]!.GetValue<string>();
            return new(IsStableOwner(owner) ? "type" : "function", owner, LastMemberPath(symbolPath));
        }

        if (direction == "input")
        {
            JsonObject? parameter = symbols?["parameters"]?.AsArray().OfType<JsonObject>()
                .Where(item => item["path"] is JsonValue)
                .OrderByDescending(item => item["path"]!.GetValue<string>().Length)
                .FirstOrDefault(item => IsWithin(path, item["path"]!.GetValue<string>()));
            if (parameter is not null)
            {
                string rootPath = parameter["path"]!.GetValue<string>();
                string owner = NormalizeOwnerType(parameter["typeSymbol"]?.GetValue<string>() ?? string.Empty);
                string memberPath = RelativePath(path, rootPath);
                return new(
                    IsStableOwner(owner) ? "type" : "function",
                    owner,
                    IsStableOwner(owner) && IsCSharpSymbol(owner)
                        ? FieldPathStandardizer.ToCSharpSymbolPath(memberPath)
                        : memberPath);
            }
        }

        JsonObject? annotatedAncestor = annotatedFields
            .Where(field => ObservedPath(field) is not null)
            .OrderByDescending(field => ObservedPath(field)!.Length)
            .FirstOrDefault(field => IsWithin(path, ObservedPath(field)!));
        string ownerRootPath = fallbackRootPath;
        string ownerSymbol = fallbackOwnerType ?? string.Empty;
        if (annotatedAncestor is not null)
        {
            ownerRootPath = ObservedPath(annotatedAncestor)!;
            ownerSymbol = annotatedAncestor["valueTypeSymbol"]?.GetValue<string>() ?? string.Empty;
        }
        else if (string.IsNullOrWhiteSpace(ownerSymbol))
        {
            ownerSymbol = symbols?["outputTypeSymbol"]?.GetValue<string>() ?? string.Empty;
        }

        string outputOwner = NormalizeOwnerType(ownerSymbol);
        bool stableOwner = IsStableOwner(outputOwner);
        string outputMemberPath = stableOwner ? RelativePath(path, ownerRootPath) : path;
        return new(
            stableOwner ? "type" : "function",
            outputOwner,
            stableOwner && IsCSharpSymbol(outputOwner)
                ? FieldPathStandardizer.ToCSharpSymbolPath(outputMemberPath)
                : outputMemberPath);
    }

    private static bool IsWithin(string path, string rootPath) =>
        FieldPathStandardizer.IsWithin(path, rootPath);

    private static IEnumerable<JsonObject> AnnotatedFields(JsonNode? symbols, string direction) =>
        symbols?["fields"]?.AsArray().OfType<JsonObject>()
            .Where(field => field["direction"]?.GetValue<string>() == direction)
        ?? [];

    private static string? ObservedPath(JsonObject field) =>
        field["serializedPath"]?.GetValue<string>()
        ?? field["path"]?.GetValue<string>();

    private static string RelativePath(string path, string rootPath) =>
        path == rootPath ? "$" : "$" + path[rootPath.Length..];

    private static string LastMemberPath(string path)
    {
        int memberStart = path.LastIndexOf("[\"", StringComparison.Ordinal);
        return memberStart < 0 ? path : "$" + path[memberStart..];
    }

    private static string NormalizeOwnerType(string symbol)
    {
        string result = symbol.Trim();
        while (result.StartsWith('&'))
        {
            result = result[1..].TrimStart();
        }

        string[] optionalPrefixes =
        [
            "core::option::Option<",
            "std::option::Option<",
            "Option<",
        ];
        string? prefix = optionalPrefixes.FirstOrDefault(candidate =>
            result.StartsWith(candidate, StringComparison.Ordinal) && result.EndsWith('>'));
        if (prefix is not null)
        {
            return NormalizeOwnerType(result[prefix.Length..^1]);
        }

        int csharpGeneric = result.IndexOf('`');
        int csharpArguments = csharpGeneric >= 0 ? result.IndexOf('[', csharpGeneric) : -1;
        if (csharpArguments >= 0)
        {
            return result[..csharpArguments];
        }

        int rustArguments = result.IndexOf('<');
        return rustArguments >= 0 ? result[..rustArguments] : result;
    }

    private static bool IsStableOwner(string owner) =>
        !string.IsNullOrWhiteSpace(owner)
        && !owner.StartsWith("System.Collections.Generic.Dictionary", StringComparison.Ordinal)
        && !owner.StartsWith("System.ValueTuple", StringComparison.Ordinal)
        && !owner.Equals("System.Object", StringComparison.Ordinal)
        && !owner.Contains("serde_json::value::Value", StringComparison.Ordinal)
        && !owner.Contains("serde_json::Value", StringComparison.Ordinal)
        && !owner.Contains("JsonNode", StringComparison.Ordinal);

    private static bool IsCSharpSymbol(string symbol) =>
        !symbol.Contains("::", StringComparison.Ordinal);
}

internal static class FieldPathStandardizer
{
    public static string NormalizeName(string name) =>
        JsonNamingPolicy.SnakeCaseLower.ConvertName(name);

    public static string? LastName(string path)
    {
        IReadOnlyList<string>? segments = Parse(path);
        return segments?.LastOrDefault(segment => segment != "*");
    }

    public static string NormalizePath(string path)
    {
        IReadOnlyList<string>? segments = Parse(path);
        return segments is null
            ? path
            : "$" + string.Concat(segments.Select(segment => segment == "*"
                ? "[*]"
                : $"[{JsonSerializer.Serialize(NormalizeName(segment))}]"));
    }

    public static string ToCSharpSymbolPath(string path)
    {
        IReadOnlyList<string>? segments = Parse(path);
        return segments is null
            ? path
            : "$" + string.Concat(segments.Select(segment => segment == "*"
                ? "[*]"
                : $"[{JsonSerializer.Serialize(string.Concat(
                    segment.Split('_', StringSplitOptions.RemoveEmptyEntries)
                        .Select(part => char.ToUpperInvariant(part[0]) + part[1..])))}]"));
    }

    public static bool AreEquivalent(string left, string right)
    {
        IReadOnlyList<string>? leftSegments = Parse(left);
        IReadOnlyList<string>? rightSegments = Parse(right);
        return leftSegments is not null
            && rightSegments is not null
            && leftSegments.Count == rightSegments.Count
            && leftSegments.Zip(rightSegments).All(pair =>
                pair.First == "*" || pair.Second == "*"
                    ? pair.First == pair.Second
                    : string.Equals(
                        NormalizeName(pair.First),
                        NormalizeName(pair.Second),
                        StringComparison.Ordinal));
    }

    public static bool IsWithin(string path, string rootPath)
    {
        IReadOnlyList<string>? pathSegments = Parse(path);
        IReadOnlyList<string>? rootSegments = Parse(rootPath);
        return pathSegments is not null
            && rootSegments is not null
            && rootSegments.Count <= pathSegments.Count
            && rootSegments.Zip(pathSegments).All(pair =>
                pair.First == "*" || pair.Second == "*"
                    ? pair.First == pair.Second
                    : string.Equals(
                        NormalizeName(pair.First),
                        NormalizeName(pair.Second),
                        StringComparison.Ordinal));
    }

    private static IReadOnlyList<string>? Parse(string path)
    {
        if (path.Length == 0 || path[0] != '$')
        {
            return null;
        }

        var segments = new List<string>();
        int index = 1;
        while (index < path.Length)
        {
            if (path.AsSpan(index).StartsWith("[*]"))
            {
                segments.Add("*");
                index += 3;
                continue;
            }
            if (!path.AsSpan(index).StartsWith("[\""))
            {
                return null;
            }

            int stringStart = index + 1;
            int cursor = stringStart + 1;
            bool escaped = false;
            while (cursor < path.Length)
            {
                char character = path[cursor];
                if (!escaped && character == '"')
                {
                    break;
                }
                escaped = !escaped && character == '\\';
                if (character != '\\')
                {
                    escaped = false;
                }
                cursor++;
            }
            if (cursor >= path.Length || cursor + 1 >= path.Length || path[cursor + 1] != ']')
            {
                return null;
            }

            segments.Add(JsonSerializer.Deserialize<string>(path[stringStart..(cursor + 1)])!);
            index = cursor + 2;
        }
        return segments;
    }
}
