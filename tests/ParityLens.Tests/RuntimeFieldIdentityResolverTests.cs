namespace ParityLens.Tests;

using System.Text.Json.Nodes;
using global::ParityLens.Web;

[TestClass]
public sealed class RuntimeFieldIdentityResolverTests
{
    [TestMethod]
    public void Resolve_CanonicalizesFallbackPathsAgainstTheNearestStableOwner()
    {
        RuntimeFieldIdentity first = RuntimeFieldIdentityResolver.Resolve(
            new JsonObject(),
            "output",
            "$[\"response\"][\"body\"][\"id\"]",
            "System.Net.Http.HttpResponseMessage",
            "$[\"response\"]");
        RuntimeFieldIdentity second = RuntimeFieldIdentityResolver.Resolve(
            new JsonObject(),
            "output",
            "$[\"diagnostic_info\"][\"http_response_message\"][\"body\"][\"id\"]",
            "System.Net.Http.HttpResponseMessage",
            "$[\"diagnostic_info\"][\"http_response_message\"]");

        Assert.AreEqual(first, second);
        Assert.AreEqual(
            new RuntimeFieldIdentity("type", "System.Net.Http.HttpResponseMessage", "$[\"Body\"][\"Id\"]"),
            first);
    }

    [TestMethod]
    public void Resolve_KeepsGenericJsonWrappersFunctionScoped()
    {
        RuntimeFieldIdentity identity = RuntimeFieldIdentityResolver.Resolve(
            new JsonObject
            {
                ["outputTypeSymbol"] = "System.Collections.Generic.Dictionary`2[System.String,System.Object]",
            },
            "output",
            "$[\"value\"][\"id\"]");

        Assert.AreEqual("function", identity.Scope);
    }

    [TestMethod]
    public void Resolve_CanonicalizesClosedGenericDeclaringTypes()
    {
        RuntimeFieldIdentity csharpFirst = ResolveAnnotatedOwner("Sdk.Response`1[[Sdk.User]]");
        RuntimeFieldIdentity csharpSecond = ResolveAnnotatedOwner("Sdk.Response`1[[Sdk.Group]]");
        RuntimeFieldIdentity csharpOpen = ResolveAnnotatedOwner("Sdk.Response`1[T]");
        RuntimeFieldIdentity rustFirst = ResolveAnnotatedOwner("sdk::Response<sdk::User>");
        RuntimeFieldIdentity rustSecond = ResolveAnnotatedOwner("sdk::Response<sdk::Group>");

        Assert.AreEqual(csharpFirst, csharpSecond);
        Assert.AreEqual(csharpFirst, csharpOpen);
        Assert.AreEqual("Sdk.Response`1", csharpFirst.OwnerTypeSymbol);
        Assert.AreEqual(rustFirst, rustSecond);
        Assert.AreEqual("sdk::Response", rustFirst.OwnerTypeSymbol);
    }

    [TestMethod]
    public void Resolve_UsesActualCSharpMemberNamesAcrossStandardCasing()
    {
        RuntimeFieldIdentity identity = RuntimeFieldIdentityResolver.Resolve(
            new JsonObject
            {
                ["fields"] = new JsonArray(new JsonObject
                {
                    ["direction"] = "output",
                    ["path"] = "$[\"DisplayName\"]",
                    ["ownerTypeSymbol"] = "Sdk.User",
                }),
            },
            "output",
            "$[\"display_name\"]");

        Assert.AreEqual(
            new RuntimeFieldIdentity("type", "Sdk.User", "$[\"DisplayName\"]"),
            identity);
    }

    [TestMethod]
    public void Resolve_CorrelatesSerializedAliasesWithActualCSharpMemberNames()
    {
        RuntimeFieldIdentity identity = RuntimeFieldIdentityResolver.Resolve(
            new JsonObject
            {
                ["fields"] = new JsonArray(new JsonObject
                {
                    ["direction"] = "output",
                    ["path"] = "$[\"NextLink\"]",
                    ["serializedPath"] = "$[\"@odata.next_link\"]",
                    ["ownerTypeSymbol"] = "Sdk.Response",
                }),
            },
            "output",
            "$[\"@odata.next_link\"]");

        Assert.AreEqual(
            new RuntimeFieldIdentity("type", "Sdk.Response", "$[\"NextLink\"]"),
            identity);
    }

    [TestMethod]
    public void ResolveValueRoot_UsesTheAnnotatedStructuralValueType()
    {
        RuntimeFieldIdentity? identity = RuntimeFieldIdentityResolver.ResolveValueRoot(
            new JsonObject
            {
                ["fields"] = new JsonArray(new JsonObject
                {
                    ["direction"] = "output",
                    ["path"] = "$[\"DiagnosticInfo\"]",
                    ["serializedPath"] = "$[\"diagnostic_info\"]",
                    ["ownerTypeSymbol"] = "Sdk.Response`1[[Sdk.User]]",
                    ["valueTypeSymbol"] = "Sdk.DiagnosticInfo",
                }),
            },
            "output",
            "$[\"diagnostic_info\"]");

        Assert.AreEqual(
            new RuntimeFieldIdentity("type", "Sdk.DiagnosticInfo", "$"),
            identity);
    }

    [TestMethod]
    public void Resolve_UsesCSharpCasingForUnannotatedStableTypeMembers()
    {
        RuntimeFieldIdentity identity = RuntimeFieldIdentityResolver.Resolve(
            new JsonObject
            {
                ["parameters"] = new JsonArray(new JsonObject
                {
                    ["path"] = "$[\"query_options\"]",
                    ["typeSymbol"] = "Sdk.QueryOptions`1[[Sdk.User]]",
                }),
            },
            "input",
            "$[\"query_options\"][\"property_set\"]");

        Assert.AreEqual(
            new RuntimeFieldIdentity("type", "Sdk.QueryOptions`1", "$[\"PropertySet\"]"),
            identity);
    }

    private static RuntimeFieldIdentity ResolveAnnotatedOwner(string ownerTypeSymbol) =>
        RuntimeFieldIdentityResolver.Resolve(
            new JsonObject
            {
                ["fields"] = new JsonArray(new JsonObject
                {
                    ["direction"] = "output",
                    ["path"] = "$[\"value\"]",
                    ["ownerTypeSymbol"] = ownerTypeSymbol,
                }),
            },
            "output",
            "$[\"value\"]");
}