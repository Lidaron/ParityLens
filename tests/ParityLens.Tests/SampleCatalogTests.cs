namespace ParityLens.Tests;

using System.Text.Json.Nodes;
using global::ParityLens.Web;

[TestClass]
public sealed class SampleCatalogTests
{
    [TestMethod]
    public void SampleCatalog_LoadsWithoutAnIntegration()
    {
        var catalog = new OperationCatalog(SampleCatalogPath());

        CatalogResponse response = catalog.GetCatalog();

        Assert.HasCount(1, response.Entities);
        Assert.AreEqual("items", response.Entities[0].Id);
        Assert.AreEqual("read-item", response.Entities[0].Operations[0].Id);
        CollectionAssert.AreEqual(
            new[] { "Baseline local", "Candidate local" },
            response.Versions.ToArray());
    }

    [TestMethod]
    public async Task SaveVersion_WritesSnapshotAndUpdatesTheActiveCatalog()
    {
        string temporaryDirectory = Path.Combine(
            Path.GetTempPath(),
            $"parity-lens-workspace-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temporaryDirectory);
        try
        {
            string activePath = Path.Combine(temporaryDirectory, "parity-data.v1.json");
            File.Copy(SampleCatalogPath(), activePath);
            var catalog = new OperationCatalog(activePath);
            var workspace = new ParityDataWorkspaceService(catalog, activePath);
            JsonNode document = JsonNode.Parse(await File.ReadAllTextAsync(activePath))!;
            document["entities"]![0]!["name"] = "Registered items";

            ParityDataSaveResult result = await workspace.SaveVersionAsync(
                new(document, "Sample update", "Public workspace test"),
                CancellationToken.None);

            Assert.IsTrue(result.Saved, string.Join(" | ", result.Validation.Errors));
            Assert.IsNotNull(result.Version);
            Assert.AreEqual("Registered items", catalog.GetCatalog().Entities[0].Name);
            Assert.IsTrue(File.Exists(Path.Combine(
                temporaryDirectory,
                "parity-data.versions",
                $"{result.Version.Id}.json")));
        }
        finally
        {
            Directory.Delete(temporaryDirectory, recursive: true);
        }
    }

    [TestMethod]
    public async Task Validate_RejectsAnUnsupportedSchemaVersion()
    {
        var catalog = new OperationCatalog(SampleCatalogPath());
        var workspace = new ParityDataWorkspaceService(catalog, SampleCatalogPath());
        JsonNode document = JsonNode.Parse(await File.ReadAllTextAsync(SampleCatalogPath()))!;
        document["schemaVersion"] = "2.0.0";

        ParityDataValidationResult result = await workspace.ValidateAsync(
            document,
            CancellationToken.None);

        Assert.IsFalse(result.Valid);
        Assert.IsTrue(result.Errors.Any(error =>
            error.Contains("schema", StringComparison.OrdinalIgnoreCase)));
    }

    private static string SampleCatalogPath() =>
        Path.Combine(AppContext.BaseDirectory, "samples", "parity-data.v1.json");
}