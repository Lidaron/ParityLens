namespace ParityLens.Web;

using System.Reflection;
using System.Runtime.Loader;

public interface IParityRunner
{
    Task<IReadOnlyList<TracePair>> CaptureAsync(
        EntityDefinition entity,
        OperationDefinition operation,
        ScenarioDefinition scenario,
        string baselineVersion,
        string candidateVersion,
        string simulatorBaseUrl,
        CancellationToken cancellationToken);
}

public static class IntegrationLoader
{
    public static IParityRunner? Load(IConfiguration configuration, string workingDirectory)
    {
        string configuredPath = configuration["ParityLens:IntegrationAssembly"]
            ?? Path.Combine("Data", "ParityLens.Integration.dll");
        string assemblyPath = Path.GetFullPath(configuredPath, workingDirectory);
        if (!File.Exists(assemblyPath))
        {
            return null;
        }

        var loadContext = new IntegrationLoadContext(assemblyPath);
        Assembly assembly = loadContext.LoadFromAssemblyPath(assemblyPath);
        Type[] runnerTypes = assembly.GetTypes().Where(type =>
            !type.IsAbstract
            && !type.IsInterface
            && typeof(IParityRunner).IsAssignableFrom(type)).ToArray();
        Type runnerType = runnerTypes.Length == 1
            ? runnerTypes[0]
            : throw new InvalidOperationException(
                $"Integration assembly '{assemblyPath}' must contain exactly one IParityRunner implementation; found {runnerTypes.Length}.");
        return Activator.CreateInstance(runnerType) as IParityRunner
            ?? throw new InvalidOperationException(
                $"Integration runner '{runnerType.FullName}' must have a public parameterless constructor.");
    }

    private sealed class IntegrationLoadContext(string assemblyPath) : AssemblyLoadContext
    {
        private readonly AssemblyDependencyResolver resolver = new(assemblyPath);

        protected override Assembly? Load(AssemblyName assemblyName)
        {
            if (assemblyName.Name == typeof(IParityRunner).Assembly.GetName().Name)
            {
                return null;
            }

            string? path = this.resolver.ResolveAssemblyToPath(assemblyName);
            return path is null ? null : this.LoadFromAssemblyPath(path);
        }

        protected override nint LoadUnmanagedDll(string unmanagedDllName)
        {
            string? path = this.resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
            return path is null ? nint.Zero : this.LoadUnmanagedDllFromPath(path);
        }
    }
}