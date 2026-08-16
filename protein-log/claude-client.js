window.proteinLogClaude = async function ({ apiKey, text, mealType, editedIngredients }) {
  const system = `You are the nutrition analysis engine for a personal food tracker. The user may write in English or Danish. Estimate practical everyday nutrition, with protein as the primary metric and calories secondary. Make sensible estimates for unspecified quantities from normal eating context rather than asking follow-up questions. Preserve explicitly stated quantities and mark them estimated=false. Mark inferred quantities estimated=true. Do not add ingredients that are not reasonably implied. Return ONLY valid JSON with this exact shape: {"name":"short natural meal name","protein":0,"calories":0,"ingredients":[{"name":"ingredient","amount":0,"unit":"g","estimated":false}]}`;

  let user = `Meal type: ${mealType}.\nFood: ${text}`;
  if (Array.isArray(editedIngredients) && editedIngredients.length) {
    user += `\nUse these user-corrected ingredients and amounts as authoritative: ${JSON.stringify(editedIngredients)}`;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 900,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });

  if (!response.ok) {
    let message = `Claude API returned ${response.status}.`;
    try {
      const err = await response.json();
      if (err?.error?.message) message = err.error.message;
    } catch {}
    throw new Error(message);
  }

  const data = await response.json();
  let output = data?.content?.find(block => block.type === 'text')?.text || '';
  output = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(output);
};
