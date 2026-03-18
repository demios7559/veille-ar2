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

    // Un seul appel avec web search activé — Claude cherche et vérifie les DOI lui-même
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: body.system,
        messages: body.messages
      })
    });

    const data = await response.json();

    // Extraire uniquement les blocs texte (ignorer les blocs tool_use/tool_result)
    if (data.content) {
      const textBlocks = data.content.filter(b => b.type === 'text');
      if (textBlocks.length > 0) {
        data.content = textBlocks;
      }
    }

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
