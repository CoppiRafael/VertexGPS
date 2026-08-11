const componentNames = [
  'topbar', 'hero', 'analysis-header', 'stats', 'tabs', 'briefing', 'overview', 'top-three', 'elevation',
  'splits', 'gradient', 'effort', 'insights', 'comparison', 'strategy', 'footer',
];

async function loadComponents() {
  const app = document.getElementById('app');

  try {
    const components = await Promise.all(
      componentNames.map(async (name) => {
        const response = await fetch(`components/${name}.html`);
        if (!response.ok) throw new Error(`Não foi possível carregar ${name}.html`);
        return response.text();
      }),
    );

    app.innerHTML = components.join('\n');
    app.setAttribute('aria-busy', 'false');
    document.dispatchEvent(new Event('vertex:ready'));
  } catch (error) {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '<p class="load-error">Não foi possível carregar a interface. Inicie um servidor local para abrir este projeto.</p>';
    console.error(error);
  }
}

loadComponents();
