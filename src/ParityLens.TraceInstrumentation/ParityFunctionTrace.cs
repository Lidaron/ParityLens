namespace ParityLens.TraceInstrumentation;

/// <summary>Captured input, output, symbols, and timing for one annotated function call.</summary>
public sealed class ParityFunctionTrace
{
    /// <summary>Initializes a function trace.</summary>
    public ParityFunctionTrace(
        string stepId,
        string functionName,
        string spanId,
        string? parentSpanId,
        int depth,
        long sequence,
        long startedTimestamp,
        long endedTimestamp,
        string inputJson,
        string outputJson,
        string symbolJson,
        long durationMilliseconds,
        bool isSuccessful)
    {
        StepId = stepId;
        FunctionName = functionName;
        SpanId = spanId;
        ParentSpanId = parentSpanId;
        Depth = depth;
        Sequence = sequence;
        StartedTimestamp = startedTimestamp;
        EndedTimestamp = endedTimestamp;
        InputJson = inputJson;
        OutputJson = outputJson;
        SymbolJson = symbolJson;
        DurationMilliseconds = durationMilliseconds;
        IsSuccessful = isSuccessful;
    }

    public string StepId { get; }

    public string FunctionName { get; }

    public string SpanId { get; }

    public string? ParentSpanId { get; }

    public int Depth { get; }

    public long Sequence { get; }

    public long StartedTimestamp { get; }

    public long EndedTimestamp { get; }

    public string InputJson { get; }

    public string OutputJson { get; }

    public string SymbolJson { get; }

    public long DurationMilliseconds { get; }

    public bool IsSuccessful { get; }
}
