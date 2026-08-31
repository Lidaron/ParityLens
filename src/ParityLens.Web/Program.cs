using ParityLens.Web;
using System.Text.Json.Nodes;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
IParityRunner? parityRunner = IntegrationLoader.Load(
    builder.Configuration,
    Directory.GetCurrentDirectory());
builder.Services.AddSingleton<OperationCatalog>();
builder.Services.AddSingleton<ParityDataWorkspaceService>();
builder.Services.AddSingleton(serviceProvider => new ComparisonSimulator(
    serviceProvider.GetRequiredService<OperationCatalog>(),
    parityRunner));
builder.Services.AddSingleton<TraceSymbolInventoryService>();

WebApplication app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/catalog", (OperationCatalog catalog) => Results.Ok(catalog.GetCatalog()));
app.MapGet("/api/runs", (ComparisonSimulator simulator) => Results.Ok(simulator.GetRecentRuns()));
app.MapGet("/api/parity-data", async (
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
    Results.Ok(await workspace.GetWorkspaceAsync(cancellationToken)));
app.MapPost("/api/parity-data/validate", async (
    JsonNode document,
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
    Results.Ok(await workspace.ValidateAsync(document, cancellationToken)));
app.MapPost("/api/parity-data/hotload", async (
    JsonNode document,
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
{
    ParityDataHotloadResult result = await workspace.HotloadAsync(document, cancellationToken);
    return result.Loaded ? Results.Ok(result) : Results.BadRequest(result);
});
app.MapGet("/api/parity-data/symbols", (TraceSymbolInventoryService inventory) =>
    Results.Ok(inventory.GetInventory()));
app.MapGet("/api/parity-data/versions", async (
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
    Results.Ok(await workspace.GetVersionsAsync(cancellationToken)));
app.MapGet("/api/parity-data/versions/{id}", async (
    string id,
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
    await workspace.GetVersionAsync(id, cancellationToken) is { } version
        ? Results.Ok(version)
        : Results.NotFound(new { error = $"Unknown parity data version '{id}'." }));
app.MapPost("/api/parity-data/versions", async (
    ParityDataSaveRequest request,
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
{
    ParityDataSaveResult result = await workspace.SaveVersionAsync(request, cancellationToken);
    return result.Saved ? Results.Ok(result) : Results.BadRequest(result);
});
app.MapPost("/api/parity-data/versions/{id}/restore", async (
    string id,
    ParityDataWorkspaceService workspace,
    CancellationToken cancellationToken) =>
    await workspace.RestoreVersionAsync(id, cancellationToken) is { } result
        ? Results.Ok(result)
        : Results.NotFound(new { error = $"Unknown parity data version '{id}'." }));
app.MapPost("/api/comparisons", async (
    ComparisonRequest request,
    ComparisonSimulator simulator,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    try
    {
        string simulatorBaseUrl = $"{context.Request.Scheme}://{context.Request.Host}/api/sdk-simulator";
        return Results.Ok(await simulator.RunAsync(request, simulatorBaseUrl, cancellationToken));
    }
    catch (ArgumentException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapMethods(
    "/api/sdk-simulator/{scenario}/{**path}",
    ["GET", "POST", "PUT", "PATCH", "DELETE"],
    (string scenario) =>
    {
        _ = scenario;
        return Results.Json(new
        {
            id = "parity-result",
            displayName = "Parity result",
            value = new object[] { new { id = "parity-item", displayName = "Parity item" } },
        });
    });

app.MapFallbackToFile("index.html");
app.Run();

public partial class Program;