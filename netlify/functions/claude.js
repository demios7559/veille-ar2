exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);

    // Étape 1 — Génération de la veille (texte uniquement, sans URLs)
    const veilleResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: body.system,
        messages: body.messages
      })
    });

    const veilleData = await veilleResp.json();
    if (!veilleResp.ok || veilleData.error) {
      return { statusCode: veilleResp.status, headers: {'Content-Type':'application/json'}, body: JSON.stringify(veilleData) };
    }

    // Extraire le JSON de la veille
    const rawText = veilleData.content[0].text;
    const clean = rawText.replace(/```json|```/g, '').trim();
    let veille;
    try { veille = JSON.parse(clean); } catch(e) {
      return { statusCode: 200, headers: {'Content-Type':'application/json'}, body: JSON.stringify(veilleData) };
    }

    // Étape 2 — Recherche des vrais DOI via web search pour chaque étude
    const toSearch = [];
    if (veille.actu) toSearch.push({ key: 'actu', query: `${veille.actu.title} ${veille.actu.source} DOI pubmed` });
    if (veille.briefs) veille.briefs.forEach((b, i) => toSearch.push({ key: `brief_${i}`, query: `${b.text.slice(0,80)} ${b.theme} pubmed DOI` }));

    // Recherche web pour chaque étude
    for (const item of toSearch) {
      try {
        const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'web-search-2025-03-05'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            system: `Tu es un assistant de recherche bibliographique. Tu dois trouver le DOI ou PMID exact d'une étude médicale en utilisant la recherche web.
Réponds UNIQUEMENT avec un JSON : {"doi": "https://doi.org/...", "pmid": "https://pubmed.ncbi.nlm.nih.gov/XXXXXXXX/", "found": true}
Si tu ne trouves pas de lien vérifié, réponds : {"found": false}
Ne génère jamais un lien inventé.`,
            messages: [{ role: 'user', content: `Trouve le DOI ou PMID exact pour cette étude : ${item.query}` }]
          })
        });

        const searchData = await searchResp.json();
        // Extraire la réponse texte (après tool use)
        const textBlock = (searchData.content || []).find(b => b.type === 'text');
        if (textBlock) {
          try {
            const parsed = JSON.parse(textBlock.text.replace(/```json|```/g,'').trim());
            if (parsed.found) {
              const url = parsed.doi || parsed.pmid;
              if (item.key === 'actu') veille.actu.url = url;
              else {
                const idx = parseInt(item.key.split('_')[1]);
                veille.briefs[idx].url = url;
              }
            }
          } catch(e) { /* pas de lien trouvé, on laisse vide */ }
        }
      } catch(e) { /* recherche échouée, on continue sans URL */ }
    }

    // Retourner la réponse finale avec les URLs vérifiées
    veilleData.content[0].text = JSON.stringify(veille);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(veilleData)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
