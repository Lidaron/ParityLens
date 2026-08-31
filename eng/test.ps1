[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    cargo test --manifest-path src/parity_lens_trace/Cargo.toml --locked
    if ($LASTEXITCODE -ne 0) {
        throw "Parity Lens Rust trace tests failed with exit code $LASTEXITCODE."
    }

    dotnet test ParityLens.slnx
    if ($LASTEXITCODE -ne 0) {
        throw ".NET tests failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}