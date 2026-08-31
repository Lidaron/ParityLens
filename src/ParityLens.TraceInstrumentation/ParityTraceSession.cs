namespace ParityLens.TraceInstrumentation;

using System.Threading;

/// <summary>Activates trace capture for annotated calls in the current asynchronous flow.</summary>
public sealed class ParityTraceSession : IDisposable
{
    private static readonly AsyncLocal<SessionState?> CurrentState = new();

    private readonly SessionState? previous;
    private bool disposed;

    private ParityTraceSession(SessionState current, SessionState? previousState)
    {
        CurrentState.Value = current;
        previous = previousState;
    }

    internal static SessionState? Current => CurrentState.Value;

    /// <summary>Starts an ambient trace capture session.</summary>
    public static ParityTraceSession Start(
        IParityFunctionTraceSink sink,
        ParityTraceCaptureOptions? captureOptions = null)
    {
        if (sink is null)
        {
            throw new ArgumentNullException(nameof(sink));
        }

        return new ParityTraceSession(
            new SessionState(sink, captureOptions ?? new ParityTraceCaptureOptions()),
            CurrentState.Value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        CurrentState.Value = previous;
    }

    internal sealed class SessionState
    {
        internal SessionState(IParityFunctionTraceSink sink, ParityTraceCaptureOptions captureOptions)
        {
            Sink = sink;
            CaptureOptions = captureOptions;
        }

        internal IParityFunctionTraceSink Sink { get; }

        internal ParityTraceCaptureOptions CaptureOptions { get; }
    }
}
