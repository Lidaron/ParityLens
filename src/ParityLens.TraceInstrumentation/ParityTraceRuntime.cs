namespace ParityLens.TraceInstrumentation;

using System.Collections;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using MethodBoundaryAspect.Fody.Attributes;
using Newtonsoft.Json.Linq;

/// <summary>Runtime support called by woven trace-function boundaries.</summary>
internal static class ParityTraceRuntime
{
    private static readonly AsyncLocal<Invocation?> CurrentInvocation = new();

    private static readonly MethodInfo WrapGenericTaskMethod = typeof(ParityTraceRuntime)
        .GetMethod(nameof(WrapGenericTaskAsync), BindingFlags.Static | BindingFlags.NonPublic)!;

    private static long sequence;

    internal static object? Enter(ParityTraceFunctionAttribute annotation, MethodExecutionArgs args)
    {
        try
        {
            ParityTraceSession.SessionState? session = ParityTraceSession.Current;
            if (session is null)
            {
                return null;
            }

            Invocation? parent = CurrentInvocation.Value;
            if (parent?.Session != session)
            {
                parent = null;
            }

            if (parent is not null && string.Equals(parent.StepId, annotation.StepId, StringComparison.Ordinal))
            {
                return null;
            }

            var invocation = new Invocation(
                annotation.StepId,
                FunctionName(args.Method),
                session,
                parent,
                CaptureInputs(args.Method, args.Arguments, annotation, session.CaptureOptions),
                CaptureSymbols(args.Method, annotation),
                Stopwatch.GetTimestamp(),
                Interlocked.Increment(ref sequence));
            CurrentInvocation.Value = invocation;
            return invocation;
        }
        catch
        {
            return null;
        }
    }

    internal static void Exit(MethodExecutionArgs args)
    {
        if (args.MethodExecutionTag is not Invocation invocation || invocation.Completed)
        {
            return;
        }

        CurrentInvocation.Value = invocation.Parent;
        if (args.ReturnValue is not Task task)
        {
            Complete(invocation, args.ReturnValue, true);
            return;
        }

        Type? resultType = TaskResultType(task.GetType());
        if (resultType is null)
        {
            args.ReturnValue = WrapTaskAsync(task, invocation);
            return;
        }

        args.ReturnValue = WrapGenericTaskMethod.MakeGenericMethod(resultType)
            .Invoke(null, new[] { args.ReturnValue, invocation });
    }

    internal static void Fail(MethodExecutionArgs args)
    {
        if (args.MethodExecutionTag is not Invocation invocation || invocation.Completed)
        {
            return;
        }

        CurrentInvocation.Value = invocation.Parent;
        Complete(invocation, args.Exception, false);
    }

    private static async Task WrapTaskAsync(Task task, Invocation invocation)
    {
        try
        {
            await task.ConfigureAwait(false);
            Complete(invocation, null, true);
        }
        catch (Exception exception)
        {
            Complete(invocation, exception, false);
            throw;
        }
    }

    private static async Task<TResult> WrapGenericTaskAsync<TResult>(Task<TResult> task, Invocation invocation)
    {
        try
        {
            TResult result = await task.ConfigureAwait(false);
            Complete(invocation, result, true);
            return result;
        }
        catch (Exception exception)
        {
            Complete(invocation, exception, false);
            throw;
        }
    }

    private static void Complete(Invocation invocation, object? output, bool isSuccessful)
    {
        if (invocation.Completed)
        {
            return;
        }

        invocation.Completed = true;
        try
        {
            long ended = Stopwatch.GetTimestamp();
            long duration = (long)((ended - invocation.Started) * 1000.0 / Stopwatch.Frequency);
            invocation.Session.Sink.OnFunctionTrace(new ParityFunctionTrace(
                invocation.StepId,
                invocation.FunctionName,
                invocation.SpanId,
                invocation.Parent?.SpanId,
                invocation.Depth,
                invocation.Sequence,
                invocation.Started,
                ended,
                invocation.InputJson,
                CaptureValue(output, invocation.Session.CaptureOptions)?.ToJsonString() ?? "null",
                invocation.SymbolJson,
                duration,
                isSuccessful));
        }
        catch
        {
            // Tracing is observational and must never affect the annotated call.
        }
    }

    private static string CaptureInputs(
        MethodBase method,
        object[] arguments,
        ParityTraceFunctionAttribute annotation,
        ParityTraceCaptureOptions captureOptions)
    {
        var result = new JsonObject();
        ParameterInfo[] parameters = method.GetParameters();
        foreach (string parameterName in annotation.InputParameters)
        {
            int index = Array.FindIndex(parameters, parameter => parameter.Name == parameterName);
            if (index >= 0 && index < arguments.Length)
            {
                result[parameterName] = CaptureValue(arguments[index], captureOptions);
            }
        }

        return result.ToJsonString();
    }

    private static string CaptureSymbols(MethodBase method, ParityTraceFunctionAttribute annotation)
    {
        var fields = new JsonArray();
        var parameters = new JsonArray();
        Assembly? tracedAssembly = method.DeclaringType?.Assembly;
        foreach (ParameterInfo parameter in method.GetParameters()
            .Where(parameter => annotation.InputParameters.Contains(parameter.Name, StringComparer.Ordinal)))
        {
            string path = "$[\"" + parameter.Name + "\"]";
            parameters.Add(new JsonObject
            {
                ["name"] = parameter.Name,
                ["typeSymbol"] = TypeSymbol(parameter.ParameterType),
                ["path"] = path,
            });
            CaptureTypeFields(
                parameter.ParameterType,
                path,
                path,
                "input",
                fields,
                new HashSet<Type>(),
                tracedAssembly);
        }

        Type outputType = method is MethodInfo methodInfo ? methodInfo.ReturnType : typeof(void);
        if (outputType.IsGenericType && outputType.GetGenericTypeDefinition() == typeof(Task<>))
        {
            outputType = outputType.GetGenericArguments()[0];
        }

        CaptureTypeFields(
            outputType,
            "$",
            "$",
            "output",
            fields,
            new HashSet<Type>(),
            tracedAssembly);
        return new JsonObject
        {
            ["functionSymbol"] = FunctionName(method),
            ["declaringTypeSymbol"] = TypeSymbol(method.DeclaringType),
            ["parameters"] = parameters,
            ["outputTypeSymbol"] = TypeSymbol(outputType),
            ["fields"] = fields,
        }.ToJsonString();
    }

    private static void CaptureTypeFields(
        Type type,
        string path,
        string serializedPath,
        string direction,
        JsonArray fields,
        HashSet<Type> visited,
        Assembly? tracedAssembly)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (type.IsArray)
        {
            CaptureTypeFields(
                type.GetElementType()!,
                path + "[*]",
                serializedPath + "[*]",
                direction,
                fields,
                visited,
                tracedAssembly);
            return;
        }

        if (type.IsGenericType)
        {
            Type definition = type.GetGenericTypeDefinition();
            if (definition == typeof(IEnumerable<>)
                || definition == typeof(IReadOnlyList<>)
                || definition == typeof(List<>))
            {
                CaptureTypeFields(
                    type.GetGenericArguments()[0],
                    path + "[*]",
                    serializedPath + "[*]",
                    direction,
                    fields,
                    visited,
                    tracedAssembly);
                return;
            }
        }

        bool explicitlyTraced = type.IsDefined(typeof(ParityTraceDataAttribute), true);
        if ((!explicitlyTraced && type.Assembly != tracedAssembly) || !visited.Add(type))
        {
            return;
        }

        foreach (PropertyInfo property in type.GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(property => property.GetIndexParameters().Length == 0))
        {
            string fieldPath = path + "[\"" + property.Name + "\"]";
            string serializedFieldPath = serializedPath + "[\"" + PropertyName(property) + "\"]";
            fields.Add(new JsonObject
            {
                ["direction"] = direction,
                ["path"] = fieldPath,
                ["serializedPath"] = serializedFieldPath,
                ["ownerTypeSymbol"] = TypeSymbol(property.DeclaringType),
                ["memberSymbol"] = TypeSymbol(property.DeclaringType) + "." + property.Name,
                ["valueTypeSymbol"] = TypeSymbol(property.PropertyType),
            });
            CaptureTypeFields(
                property.PropertyType,
                fieldPath,
                serializedFieldPath,
                direction,
                fields,
                visited,
                tracedAssembly);
        }
    }

    private static JsonNode? CaptureValue(object? value, ParityTraceCaptureOptions captureOptions)
    {
        return CaptureValue(value, captureOptions, new HashSet<object>(ReferenceComparer.Instance), 0);
    }

    private static JsonNode? CaptureValue(
        object? value,
        ParityTraceCaptureOptions captureOptions,
        HashSet<object> visited,
        int depth)
    {
        if (value is null)
        {
            return null;
        }

        if (depth > 16)
        {
            return JsonValue.Create("[MAX_DEPTH]");
        }

        if (captureOptions.TryFormat(value, out JsonNode? formatted))
        {
            return formatted;
        }

        Type type = value.GetType();
        if (IsScalar(type))
        {
            return JsonSerializer.SerializeToNode(value, type);
        }

        if (value is Uri uri)
        {
            return JsonValue.Create(uri.ToString());
        }

        if (value is Version version)
        {
            return JsonValue.Create(version.ToString());
        }

        if (value is HttpMethod method)
        {
            return JsonValue.Create(method.Method);
        }

        if (value is Exception exception)
        {
            return CaptureException(exception);
        }

        if (value is HttpRequestMessage request)
        {
            return CaptureHttpRequest(request);
        }

        if (value is HttpResponseMessage response)
        {
            return CaptureHttpResponse(response);
        }

        if (value is JToken token)
        {
            return JsonNode.Parse(token.ToString(Newtonsoft.Json.Formatting.None));
        }

        if (type.IsEnum)
        {
            return CaptureEnum(value, type);
        }

        if (!type.IsValueType && !visited.Add(value))
        {
            return null;
        }

        if (value is IDictionary dictionary)
        {
            var result = new JsonObject();
            foreach (DictionaryEntry entry in dictionary)
            {
                result[Convert.ToString(entry.Key, System.Globalization.CultureInfo.InvariantCulture)!] =
                    CaptureValue(entry.Value, captureOptions, visited, depth + 1);
            }

            return result;
        }

        if (value is IEnumerable items && value is not string)
        {
            var result = new JsonArray();
            foreach (object? item in items)
            {
                result.Add(CaptureValue(item, captureOptions, visited, depth + 1));
            }

            return result;
        }

        return CaptureObject(value, type, captureOptions, visited, depth);
    }

    private static JsonObject CaptureObject(
        object value,
        Type type,
        ParityTraceCaptureOptions captureOptions,
        HashSet<object> visited,
        int depth)
    {
        var result = new JsonObject();
        BindingFlags propertyFlags = BindingFlags.Instance | BindingFlags.Public;
        if (type.IsDefined(typeof(ParityTraceDataAttribute), true))
        {
            propertyFlags |= BindingFlags.NonPublic;
        }

        foreach (PropertyInfo property in type.GetProperties(propertyFlags)
            .Where(property => property.GetIndexParameters().Length == 0 && property.GetMethod is not null))
        {
            try
            {
                result[PropertyName(property)] = CaptureValue(
                    property.GetValue(value),
                    captureOptions,
                    visited,
                    depth + 1);
            }
            catch
            {
            }
        }

        foreach (FieldInfo field in type.GetFields(BindingFlags.Instance | BindingFlags.Public))
        {
            if (!result.ContainsKey(field.Name))
            {
                result[JsonNamingPolicy.SnakeCaseLower.ConvertName(field.Name)] = CaptureValue(
                    field.GetValue(value),
                    captureOptions,
                    visited,
                    depth + 1);
            }
        }

        return result;
    }

    private static JsonObject CaptureEnum(object value, Type type)
    {
        string name = Enum.GetName(type, value) ?? value.ToString()!;
        long numericValue = Convert.ToInt64(value, System.Globalization.CultureInfo.InvariantCulture);
        string[] names = type.IsDefined(typeof(FlagsAttribute), false)
            ? value.ToString()!.Split(new[] { ", " }, StringSplitOptions.RemoveEmptyEntries)
            : new[] { name };
        var members = new JsonArray(Enum.GetValues(type).Cast<object>().Select(member => (JsonNode)new JsonObject
        {
            ["symbol"] = type.FullName + "." + Enum.GetName(type, member),
            ["name"] = Enum.GetName(type, member),
            ["value"] = Convert.ToInt64(member, System.Globalization.CultureInfo.InvariantCulture),
        }).ToArray());
        return new JsonObject
        {
            ["enum_id"] = null,
            ["enum_symbol"] = type.FullName,
            ["enum_type"] = type.Name,
            ["enum_name"] = name,
            ["enum_value"] = numericValue,
            ["enum_names"] = new JsonArray(names.Select(item => (JsonNode)JsonValue.Create(item)!).ToArray()),
            ["enum_members"] = members,
            ["enum_flags"] = type.IsDefined(typeof(FlagsAttribute), false),
        };
    }

    private static JsonObject CaptureException(Exception exception)
    {
        return new JsonObject
        {
            ["message"] = exception.Message,
            ["exception_type"] = exception.GetType().FullName,
            ["status_code"] = null,
            ["is_client_error"] = false,
            ["is_server_error"] = false,
            ["is_retryable"] = exception is HttpRequestException,
            ["is_network_error"] = exception is HttpRequestException,
            ["is_timeout"] = exception is TimeoutException || exception is TaskCanceledException,
        };
    }

    private static JsonObject CaptureHttpRequest(HttpRequestMessage request)
    {
        string? body = request.Content?.ReadAsStringAsync().ConfigureAwait(false).GetAwaiter().GetResult();
        return new JsonObject
        {
            ["method"] = request.Method?.Method,
            ["uri"] = request.RequestUri?.ToString(),
            ["headers"] = CaptureHeaders(request.Headers, request.Content?.Headers),
            ["body"] = ParseBody(body),
        };
    }

    private static JsonObject CaptureHttpResponse(HttpResponseMessage response)
    {
        string? body = response.Content?.ReadAsStringAsync().ConfigureAwait(false).GetAwaiter().GetResult();
        return new JsonObject
        {
            ["status_code"] = (int)response.StatusCode,
            ["version"] = response.Version?.ToString(),
            ["headers"] = CaptureHeaders(response.Headers, response.Content?.Headers),
            ["body"] = ParseBody(body),
        };
    }

    private static JsonObject CaptureHeaders(params HttpHeaders?[] headerSets)
    {
        var result = new JsonObject();
        foreach (HttpHeaders headers in headerSets.Where(headers => headers is not null)!)
        {
            foreach (KeyValuePair<string, IEnumerable<string>> header in headers
                .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase))
            {
                string name = header.Key.ToLowerInvariant();
                string[] values = IsCredentialHeader(name) ? new[] { "[REDACTED]" } : header.Value.ToArray();
                result[name] = values.Length == 1
                    ? JsonValue.Create(values[0])
                    : new JsonArray(values.Select(item => (JsonNode)JsonValue.Create(item)!).ToArray());
            }
        }

        return result;
    }

    private static JsonNode? ParseBody(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(body!);
        }
        catch (JsonException)
        {
            return JsonValue.Create(body);
        }
    }

    private static bool IsScalar(Type type) =>
        type.IsPrimitive || type == typeof(string) || type == typeof(decimal) || type == typeof(Guid)
        || type == typeof(DateTime) || type == typeof(DateTimeOffset) || type == typeof(TimeSpan);

    private static Type? TaskResultType(Type type)
    {
        for (Type? current = type; current is not null; current = current.BaseType)
        {
            if (current.IsGenericType && current.GetGenericTypeDefinition() == typeof(Task<>))
            {
                return current.GetGenericArguments()[0];
            }
        }

        return null;
    }

    private static bool IsCredentialHeader(string name) =>
        string.Equals(name, "authorization", StringComparison.OrdinalIgnoreCase)
        || string.Equals(name, "proxy-authorization", StringComparison.OrdinalIgnoreCase)
        || string.Equals(name, "cookie", StringComparison.OrdinalIgnoreCase)
        || string.Equals(name, "set-cookie", StringComparison.OrdinalIgnoreCase);

    private static string PropertyName(PropertyInfo property)
    {
        var systemTextName = property.GetCustomAttribute<System.Text.Json.Serialization.JsonPropertyNameAttribute>();
        if (!string.IsNullOrWhiteSpace(systemTextName?.Name))
        {
            return systemTextName!.Name;
        }

        var newtonsoftName = property.GetCustomAttribute<Newtonsoft.Json.JsonPropertyAttribute>();
        return !string.IsNullOrWhiteSpace(newtonsoftName?.PropertyName)
            ? newtonsoftName!.PropertyName!
            : JsonNamingPolicy.SnakeCaseLower.ConvertName(property.Name);
    }

    private static string FunctionName(MethodBase method) =>
        TypeSymbol(method.DeclaringType) + "." + method.Name;

    private static string TypeSymbol(Type? type) => type?.FullName ?? type?.ToString() ?? string.Empty;

    private sealed class Invocation
    {
        internal Invocation(
            string stepId,
            string functionName,
            ParityTraceSession.SessionState session,
            Invocation? parent,
            string inputJson,
            string symbolJson,
            long started,
            long sequenceNumber)
        {
            StepId = stepId;
            FunctionName = functionName;
            Session = session;
            Parent = parent;
            InputJson = inputJson;
            SymbolJson = symbolJson;
            Started = started;
            Sequence = sequenceNumber;
            SpanId = Guid.NewGuid().ToString("N");
            Depth = parent is null ? 0 : parent.Depth + 1;
        }

        internal string StepId { get; }

        internal string FunctionName { get; }

        internal ParityTraceSession.SessionState Session { get; }

        internal Invocation? Parent { get; }

        internal string InputJson { get; }

        internal string SymbolJson { get; }

        internal long Started { get; }

        internal long Sequence { get; }

        internal string SpanId { get; }

        internal int Depth { get; }

        internal bool Completed { get; set; }
    }

    private sealed class ReferenceComparer : IEqualityComparer<object>
    {
        internal static readonly ReferenceComparer Instance = new();

        public new bool Equals(object? left, object? right) => ReferenceEquals(left, right);

        public int GetHashCode(object value) => RuntimeHelpers.GetHashCode(value);
    }
}
