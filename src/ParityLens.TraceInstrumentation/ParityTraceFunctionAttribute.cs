namespace ParityLens.TraceInstrumentation;

using MethodBoundaryAspect.Fody.Attributes;

/// <summary>Enables automatic input and output tracing for an integration function.</summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = true, Inherited = false)]
public sealed class ParityTraceFunctionAttribute : OnMethodBoundaryAspect
{
    /// <summary>Initializes a new annotation.</summary>
    public ParityTraceFunctionAttribute(string stepId, params string[] inputParameters)
    {
        StepId = stepId;
        InputParameters = inputParameters ?? Array.Empty<string>();
    }

    public string StepId { get; }

    public string[] InputParameters { get; }

    /// <inheritdoc />
    public override void OnEntry(MethodExecutionArgs args)
    {
        args.MethodExecutionTag = ParityTraceRuntime.Enter(this, args);
    }

    /// <inheritdoc />
    public override void OnExit(MethodExecutionArgs args)
    {
        ParityTraceRuntime.Exit(args);
    }

    /// <inheritdoc />
    public override void OnException(MethodExecutionArgs args)
    {
        ParityTraceRuntime.Fail(args);
    }
}
