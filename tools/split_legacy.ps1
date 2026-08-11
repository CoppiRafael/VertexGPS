param(
  [string]$Source = "legacy/vertex_la_mision_v3.html"
)

$ErrorActionPreference = 'Stop'

function Write-Utf8File {
  param([string]$Path, [string]$Content)
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::WriteAllText((Join-Path $PWD $Path), $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-MatchContent {
  param([string]$Text, [string]$Pattern, [string]$Description)
  $match = [regex]::Match($Text, $Pattern)
  if (-not $match.Success) { throw "Não foi possível localizar: $Description" }
  $match.Groups['content'].Value.Trim()
}

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
  throw "Arquivo de origem não encontrado: $Source"
}

$sourceText = [System.IO.File]::ReadAllText((Join-Path $PWD $Source))
$css = Get-MatchContent $sourceText '(?s)<style>\s*(?<content>.*?)\s*</style>' 'CSS embutido'
$body = Get-MatchContent $sourceText '(?s)<body>\s*(?<content>.*?)\s*<script>' 'conteúdo HTML'
$script = Get-MatchContent $sourceText '(?s)<script>\s*(?<content>.*?)\s*</script>\s*</body>' 'JavaScript embutido'

$markers = [regex]::Matches($body, '(?s)<!--\s*[^>]+?\s*-->')
if ($markers.Count -ne 12) { throw "Esperava 12 seções HTML, mas encontrei $($markers.Count)." }

$names = @(
  'topbar', 'hero', 'analysis-header', 'stats', 'tabs', 'overview', 'top-three',
  'elevation', 'splits', 'gradient', 'strategy', 'footer'
)

for ($index = 0; $index -lt $markers.Count; $index++) {
  $start = $markers[$index].Index + $markers[$index].Length
  $end = if ($index -lt $markers.Count - 1) { $markers[$index + 1].Index } else { $body.Length }
  $content = $body.Substring($start, $end - $start).Trim()
  if ($index -eq $markers.Count - 1) {
    # A última seção também fecha o container .wrap original.
    $content = [regex]::Replace($content, '(?s)\s*</div>\s*$', '')
  }
  Write-Utf8File "components/$($names[$index]).html" $content
}

$dataMatch = [regex]::Match($script, '(?s)^(?<data>const D=.*?;)\s*const P=D\.p,S=D\.s,G=D\.gr,T3=D\.t3;(?<app>.*)$')
if (-not $dataMatch.Success) { throw 'Não foi possível separar os dados da lógica JavaScript.' }

Write-Utf8File 'assets/css/main.css' $css
Write-Utf8File 'assets/js/data.js' $dataMatch.Groups['data'].Value.Trim()
Write-Utf8File 'assets/js/app.js' ("const P=D.p,S=D.s,G=D.gr,T3=D.t3;" + $dataMatch.Groups['app'].Value).Replace("window.addEventListener('DOMContentLoaded',()=>{initMap();initSplits();initStrat();});", "document.addEventListener('vertex:ready',()=>{initMap();initSplits();initStrat();});")
