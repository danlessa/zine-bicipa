// Place-name helpers: cleaning eBird hotspot names and choosing the pt-BR
// contraction (da/de/do/das/dos) for the cover title "As aves ___ <lugar>".

const Place = (() => {
  // First word of the place name (accents stripped, lowercase, no trailing dot)
  // → contraction. Proper names (cities, neighbourhoods) fall back to "de".
  const MASC = [
    'parque', 'pq', 'jardim', 'jd', 'bosque', 'horto', 'lago', 'sitio', 'museu',
    'instituto', 'campus', 'centro', 'zoologico', 'zoo', 'cemiterio', 'rio',
    'ribeirao', 'corrego', 'morro', 'pico', 'clube', 'viveiro', 'condominio',
    'aeroporto', 'largo', 'nucleo', 'mirante', 'vale', 'refugio', 'recanto',
    'caminho', 'terreno', 'brejo', 'banhado', 'pantano', 'haras', 'cerrado',
    'manguezal', 'mangue', 'pomar', 'quintal', 'campo', 'cais', 'porto',
    'observatorio', 'hospital', 'estadio', 'autodromo', 'residencial',
    'conjunto', 'bairro', 'distrito', 'municipio', 'sesc', 'ceu', 'jockey',
    'joquei', 'memorial', 'santuario', 'mosteiro', 'convento', 'seminario',
    'colegio', 'orquidario', 'arboreto', 'pesqueiro', 'trecho', 'lote',
    'acude', 'reservatorio', 'canal', 'pqe', 'pe', 'pn', 'parna', 'monumento',
    'cinturao', 'complexo', 'rancho', 'pateo', 'patio', 'calcadao',
    'litoral', 'estuario', 'delta', 'mar', 'oceano', 'pontal',
  ];
  const MASC_PL = ['jardins', 'parques', 'campos', 'lagos', 'bosques', 'morros', 'rios'];
  const FEM = [
    'praca', 'pca', 'reserva', 'represa', 'lagoa', 'fazenda', 'faz', 'mata',
    'serra', 'cidade', 'universidade', 'rua', 'avenida', 'av', 'estacao',
    'area', 'apa', 'ilha', 'praia', 'trilha', 'chacara', 'estrada', 'rod',
    'rodovia', 'floresta', 'unidade', 'varzea', 'baia', 'vila', 'cachoeira',
    'gruta', 'rppn', 'rebio', 'esec', 'flona', 'arie', 'usp', 'unicamp',
    'unesp', 'ufscar', 'unifesp', 'ufmg', 'ufrj', 'escola', 'faculdade',
    'igreja', 'capela', 'marginal', 'ciclovia', 'ponte', 'barragem', 'base',
    'aldeia', 'comunidade', 'horta', 'granja', 'quinta', 'colonia', 'regiao',
    'zona', 'orla', 'margem', 'ponta', 'enseada', 'restinga', 'nascente',
    'fonte', 'pedreira', 'mina', 'sede', 'casa', 'ecovila', 'chapada',
    'planicie', 'lagoinha', 'represinha', 'usina', 'alameda',
    'travessa', 'ladeira', 'via',
  ];
  const FEM_PL = [
    'trilhas', 'lagoas', 'matas', 'ilhas', 'praias', 'serras', 'cachoeiras',
    'represas', 'fazendas', 'chacaras',
  ];
  const LOOKUP = new Map([
    ...MASC.map((w) => [w, 'do']),
    ...FEM.map((w) => [w, 'da']),
    ...MASC_PL.map((w) => [w, 'dos']),
    ...FEM_PL.map((w) => [w, 'das']),
  ]);

  function stripAccents(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function firstWord(name) {
    const w = stripAccents(name.trim().toLowerCase()).split(/[\s\-–—,/(]+/)[0] || '';
    return w.replace(/\.+$/, '');
  }

  // Returns one of 'da', 'de', 'do', 'das', 'dos'.
  function guessPreposition(name) {
    const w = firstWord(name);
    if (!w) return 'de';
    // Leading article: "A Mata Atlântica" / "O Bosque"
    if (w === 'o') return 'do';
    if (w === 'a') return 'da';
    if (w === 'os') return 'dos';
    if (w === 'as') return 'das';
    return LOOKUP.get(w) || 'de';
  }

  // Drops a leading article ("O Bosque" → "Bosque") when the contraction
  // already carries it.
  function stripArticle(name) {
    return name.replace(/^(o|a|os|as)\s+/i, '');
  }

  // eBird hotspot names often look like "São Paulo--Parque Ibirapuera" or
  // "Parque X (acesso pela rua Y)". Keep it readable for a cover title.
  function cleanHotspotName(name) {
    return name
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s*--\s*/g, ' – ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return { guessPreposition, cleanHotspotName, stripArticle };
})();
