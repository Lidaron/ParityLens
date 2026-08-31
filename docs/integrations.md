# SDK integration guide

An integration connects registered SDK implementations to the SDK-neutral Parity Lens host. Keep integration code, SDK source, generated fixtures, and secrets under the gitignored `Data/` directory or in a separate private repository.

## Registration model

A running host loads exactly one integration assembly and exactly one public, parameterless `IParityRunner` implementation from it. You do not need a runner for every SDK pair. The runner owns a registry of SDK adapters keyed by the exact strings in `versions`, resolves the requested baseline and candidate independently, captures both executions, and aligns their traces by shared function ID.

For example, registering `C# SDK 2.4.0`, `C# SDK 2.5.0`, and `Rust SDK 2.4.0` in one runner supports any ordered baseline/candidate selection among those versions. A C#-to-C# request must execute the C# adapter on both sides; changing a selector must never change only the displayed label.

Adding an SDK registration requires all of these steps:

1. Check out the SDK source or select a package/build artifact.
2. Add it to the local integration build and apply the required trace annotations.
3. Register its exact version string with one adapter in the runner.
4. Add the same version string and its exact symbols to `Data/parity-data.v1.json`.
5. Rebuild the SDK, integration, and host before running a comparison.

The catalog advertises available versions; the runner makes those versions executable. A version present in only one of those places is an invalid local registration.

Git submodules are the documented workflow when the integration builds or annotates local SDK source. They are not required when an adapter consumes a package release or an externally built artifact. A comparison needs one registered checkout or artifact for each selected version, but it does not need a pair-specific checkout or runner.

## Local source checkouts

Parity Lens does not ship SDK repositories, gitlinks, or `.gitmodules` metadata. For an unmodified source checkout that does not need submodule metadata, clone each SDK under a stable registration name in `Data/sources/`:

```powershell
$sdkName = '<sdk-name>'
$sdkRepository = '<sdk-repository-url>'
$sdkRevision = '<sdk-revision>'

New-Item -ItemType Directory -Force Data/sources | Out-Null
git clone $sdkRepository "Data/sources/$sdkName"
git -C "Data/sources/$sdkName" checkout $sdkRevision
```

Repeat the block for every SDK version that will be registered. Directory names identify SDK registrations, not fixed baseline and candidate roles; either registration may be selected on either side of a comparison.

When tracing requires limited attribute or annotation changes in SDK source, register each SDK as a local-only submodule instead. This keeps the SDK repository boundary visible to Git and IDEs without making it part of the Parity Lens checkout. Run the following block once for every SDK version you want the runner to expose:

```powershell
$sdkName = '<sdk-name>'
$sdkRepository = '<sdk-repository-url>'
$sdkRevision = '<sdk-revision>'

git submodule add --force --name $sdkName $sdkRepository "submodules/$sdkName"
git restore --staged -- .gitmodules "submodules/$sdkName"
git -C "submodules/$sdkName" checkout $sdkRevision
git status --short
```

Repeat the command for every SDK used by the comparison. The force option is required because `submodules/` is intentionally ignored. Unstaging the generated gitlink and `.gitmodules` entry leaves the registration in the local working tree and `.git/config`; both `submodules/` and `.gitmodules` are ignored, so `git status --short` must not list either one. Do not commit SDK gitlinks or submodule metadata to Parity Lens. Commit reusable tracing changes to an appropriate branch in the SDK repository, if needed.

A typical multi-SDK local layout is:

```text
Data/
    parity-data.v1.json
    Integration/
        ParityLens.Integration.csproj
        LocalParityRunner.cs
    RustBridge/
        Cargo.toml
        src/
submodules/
    contoso-csharp/
    contoso-rust/
```

To build the host, integration, and SDK projects together in an IDE, create an ignored local solution and add only the projects needed by that comparison:

```powershell
Copy-Item ParityLens.slnx ParityLens.local.slnx
dotnet sln ParityLens.local.slnx add Data/Integration/ParityLens.Integration.csproj
dotnet sln ParityLens.local.slnx add submodules/<csharp-sdk>/<path-to-sdk-project>.csproj
dotnet build ParityLens.local.slnx
```

Use `ProjectReference` from the local integration project to every C# SDK project under `submodules/`. For Rust SDKs, use Cargo path dependencies from a local bridge crate and build that crate before the .NET integration. The runner can call the bridge through the process, native-library, or serialization boundary chosen by the integration. Keep integration code, solution membership, machine-specific paths, and build outputs under ignored locations. The shipped `ParityLens.slnx` must continue to build without SDK access.

An integration project may also use package references or build output supplied by another repository. Keep machine-specific paths in a local MSBuild props file or environment variable under `Data/`.

## Runner assembly

Reference [`src/ParityLens.Web/ParityLens.Web.csproj`](../src/ParityLens.Web/ParityLens.Web.csproj) from a local integration project and implement `ParityLens.Web.IParityRunner`:

```csharp
public sealed class LocalParityRunner : IParityRunner
{
    private readonly IReadOnlyDictionary<string, ILocalSdkAdapter> adapters =
        new Dictionary<string, ILocalSdkAdapter>(StringComparer.Ordinal)
        {
            ["C# SDK 2.4.0"] = new CSharpSdk240Adapter(),
            ["Rust SDK 2.4.0"] = new RustSdk240Adapter(),
        };

    public Task<IReadOnlyList<TracePair>> CaptureAsync(
        EntityDefinition entity,
        OperationDefinition operation,
        ScenarioDefinition scenario,
        string baselineVersion,
        string candidateVersion,
        string simulatorBaseUrl,
        CancellationToken cancellationToken)
    {
        ILocalSdkAdapter baseline = GetAdapter(baselineVersion);
        ILocalSdkAdapter candidate = GetAdapter(candidateVersion);

        // Capture each selected SDK independently, then align both traces by
        // the stable function IDs declared in parity-data.v1.json.
        return CaptureAndAlignAsync(
            baseline,
            candidate,
            entity,
            operation,
            scenario,
            simulatorBaseUrl,
            cancellationToken);
    }

    private ILocalSdkAdapter GetAdapter(string version) =>
        adapters.TryGetValue(version, out ILocalSdkAdapter? adapter)
            ? adapter
            : throw new ArgumentException($"No SDK adapter is registered for '{version}'.");
}
```

`ILocalSdkAdapter` and `CaptureAndAlignAsync` are integration-owned abstractions, not Parity Lens APIs. Their purpose is to keep version dispatch separate from pair alignment. Each adapter should execute one registered SDK version and return native trace spans; the aligner converts the two captures into `TracePair` records. Do not branch only on “baseline” versus “candidate,” and do not assume one side is always C# or Rust.

For the default deployed layout, publish the assembly and its dependencies to `Data/`, naming the entry assembly `ParityLens.Integration.dll`. It must contain exactly one concrete `IParityRunner` with a public parameterless constructor. During local development, keep normal build output under `Data/Integration/bin` and set `ParityLens__IntegrationAssembly` to its absolute path as shown in [Build and run registered SDKs](#build-and-run-registered-sdks).

```powershell
$env:ParityLens__IntegrationAssembly = (
    Resolve-Path 'Data/Integration/bin/Debug/net8.0/ParityLens.Integration.dll'
).Path
```

The plugin contract is intentionally small. SDK construction, native loading, transport replacement, outcome conversion, and runtime-specific formatters remain owned by the integration.

When two versions of the same managed SDK cannot coexist in one .NET load context, isolate each adapter in its own process or `AssemblyLoadContext`. Apply equivalent isolation to native libraries that export colliding names. The one-runner rule still applies: the runner coordinates those isolated adapters and returns one aligned result.

## Catalog registration

Copy [`samples/parity-data.v1.json`](../samples/parity-data.v1.json) to `Data/parity-data.v1.json` and replace the sample operation. Register exact runtime symbols only at the edges:

- `versions` lists values accepted by the runner;
- `functions[].id` is the stable cross-runtime step ID;
- function endpoints contain exact compiled C# and Rust symbols;
- field endpoints identify type roots or exceptional paths that cannot normalize implicitly;
- enum members map exact runtime variants to shared names and values;
- operation artifacts provide invocation inputs, request assertions, and response bytes.

Use the Data Studio to inspect trace-generated symbols and maintain mappings. Prefer paired type roots and normalized aliases over per-field endpoints.

Never commit production tokens or customer data. Fixture credentials should be obvious inert placeholders, and integrations should redact sensitive values before they enter a trace.

## Build and run registered SDKs

Run these commands from the Parity Lens repository root. Build the Rust bridge first when the integration uses one, then build the ignored local solution:

```powershell
cargo build --manifest-path Data/RustBridge/Cargo.toml
dotnet build ParityLens.local.slnx
```

Point the host at the integration assembly produced by that build. Launching the built host from the repository root ensures it discovers `Data/parity-data.v1.json`; the explicit content root keeps browser assets under the web project:

```powershell
$env:ParityLens__IntegrationAssembly = (
        Resolve-Path 'Data/Integration/bin/Debug/net8.0/ParityLens.Integration.dll'
).Path
$webRoot = (Resolve-Path 'src/ParityLens.Web').Path

dotnet 'src/ParityLens.Web/bin/Debug/net8.0/ParityLens.Web.dll' `
    --contentRoot $webRoot `
    --urls 'http://127.0.0.1:5187'
```

Open `http://127.0.0.1:5187`, select any registered baseline and candidate, and run the comparison. To add another SDK later, add its local-only submodule, build reference or Cargo path dependency, runner adapter entry, catalog version, and symbol mappings; then rerun the build commands above. No additional `IParityRunner` implementation is required.

## C# IL weaving

Reference `ParityLens.TraceInstrumentation` from the SDK project whose concrete methods will be woven. Attribute-driven instrumentation is required; no runtime proxies are involved.

Annotate concrete methods and selected structural types:

```csharp
using ParityLens.TraceInstrumentation;

[ParityTraceData]
public sealed class ItemResponse
{
    public required string Id { get; init; }
}

public sealed class ItemClient
{
    [ParityTraceFunction("items/read-item", "id")]
    public async Task<ItemResponse> ReadAsync(
        string id,
        CancellationToken cancellationToken = default)
    {
        // Production implementation.
    }
}
```

The attribute must be on the implementation method, not only an interface declaration. Select only parameters useful for comparison; never select tokens, cookies, credentials, or cancellation tokens.

Add `MethodBoundaryAspect.Fody` and a Fody configuration to the SDK project. When consuming the instrumentation project directly, preserve its build assets so the aspect weaver runs after compilation:

```xml
<ItemGroup>
  <ProjectReference Include="path/to/ParityLens.TraceInstrumentation.csproj" />
  <PackageReference Include="Fody" Version="6.9.3" PrivateAssets="all" />
  <PackageReference Include="MethodBoundaryAspect.Fody" Version="2.0.149" PrivateAssets="all" />
</ItemGroup>
```

```xml
<Weavers>
  <MethodBoundaryAspect />
</Weavers>
```

Run an SDK operation inside an ambient capture session:

```csharp
var sink = new IntegrationTraceSink();
var options = new ParityTraceCaptureOptions()
    .AddFormatter<ExternalType>(FormatExternalType);

using ParityTraceSession session = ParityTraceSession.Start(sink, options);
ItemResponse response = await client.ReadAsync("item-1", cancellationToken);
```

Use integration formatters for foreign or intentionally transformed values. Keep the SDK free of sinks and integration-specific runtime state.

After building, verify the woven assembly rather than assuming the package reference was enough. A focused test should open a session, call an annotated method, and assert that one trace contains the expected step ID, symbol, selected input, output, and parent relationship.

## Rust function annotations

Add local path dependencies while developing:

```toml
[dependencies]
parity_lens_trace = { path = "../../../src/parity_lens_trace" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Annotate concrete functions and data owned by the SDK:

```rust
use parity_lens_trace::{trace_data, trace_enum, trace_function};

#[trace_enum]
pub enum ItemKind {
    Standard = 0,
    Featured = 1,
}

#[trace_data]
pub struct ItemResponse {
    pub id: String,
    pub kind: ItemKind,
    #[parity_trace(redact)]
    pub authorization: String,
}

impl ItemClient {
    #[trace_function("items/read-item", "id")]
    pub async fn read(&self, id: &str) -> Result<ItemResponse, Error> {
        // Production implementation.
    }
}
```

`#[trace_function]` accepts a stable step ID followed by parameter names from that Rust function. The names need not match C# names. `#[trace_data]` supports `nested`, `skip`, `redact`, and `with = "serializer_path"` field policies. Use `trace_flags!` for bitflags values.

Capture one public operation in a task-local scope:

```rust
let capture = parity_lens_trace::capture(
    parity_lens_trace::TraceOptions::default(),
    client.read("item-1"),
).await;

let output = capture.output;
let traces = capture.traces;
```

The proc macros add capture behavior around existing function bodies. Do not add manual trace calls to production logic. For foreign HTTP, time, and byte types, use the provided serializers or an explicit `#[parity_trace(with = "...")]` adapter.

## Transport fixture

Each runtime must invoke its real public SDK operation. Replace only the final outgoing transport:

1. Capture the method, URI, headers, and exact request bytes.
2. Validate them against `artifact.request` and its runtime-specific aliases.
3. Return the exact status, HTTP version, headers, and `bodyText` from the selected fixture.
4. Record the number of outgoing sends so retries and fallback are observable.

Do not mock request builders, executors, resilience layers, or response parsers. Those layers are the behavior Parity Lens compares.

## Validation checklist

- A clean clone builds and opens the neutral sample without SDK source.
- The integration assembly loads from `Data/` with no repository changes.
- Both runtimes execute the same operation artifact and scenario response.
- C# traces prove IL weaving occurred on concrete implementation methods.
- Rust traces prove annotations preserve output and error semantics.
- Exact symbols resolve to shared function, field, enum, outcome, and error IDs.
- Sensitive inputs are omitted or redacted.
- No SDK repository, generated fixture, credential, or local path is tracked.