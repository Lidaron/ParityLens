namespace ParityLens.Tests;

using global::ParityLens.TraceInstrumentation;

[TestClass]
public sealed class TraceInstrumentationIsolationTests
{
    [TestMethod]
    public void InstrumentationAssembly_HasNoWebHostDependency()
    {
        string[] dependencies = typeof(ParityTraceSession).Assembly
            .GetReferencedAssemblies()
            .Select(assembly => assembly.Name ?? string.Empty)
            .Where(name => name.Equals("ParityLens.Web", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        Assert.IsEmpty(dependencies, $"Unexpected SDK dependencies: {string.Join(", ", dependencies)}");
    }
}
