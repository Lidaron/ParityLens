namespace ParityLens.TraceInstrumentation;

/// <summary>Marks an integration-owned class or struct for structural trace capture.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct, Inherited = true)]
public sealed class ParityTraceDataAttribute : Attribute
{
}
