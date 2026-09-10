const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export function openAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

const panelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['panel', 'circuits', 'warnings'],
  properties: {
    panel: {
      type: 'object',
      additionalProperties: false,
      required: ['manufacturer', 'mainAmps', 'spaceCount', 'confidence'],
      properties: {
        manufacturer: { type: ['string', 'null'] },
        mainAmps: { type: ['integer', 'null'] },
        spaceCount: { type: ['integer', 'null'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    circuits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['circuit', 'side', 'amps', 'poles', 'breakerType', 'description', 'confidence', 'needsReview', 'notes'],
        properties: {
          circuit: { type: 'integer', minimum: 1 },
          side: { type: 'string', enum: ['left', 'right'] },
          amps: { type: ['integer', 'null'] },
          poles: { type: ['integer', 'null'], enum: [1, 2, null] },
          breakerType: { type: 'string', enum: ['standard', 'afci', 'gfci', 'dual', 'surge', 'unknown'] },
          description: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          needsReview: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

function imagePart(file) {
  return {
    type: 'input_image',
    image_url: `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`,
  };
}

function parseResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

export async function analyzePanelPhotos({ files, record }) {
  if (!openAIConfigured()) {
    const error = new Error('OPENAI_API_KEY is not configured.');
    error.status = 503;
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }
  if (!files?.length) {
    const error = new Error('Panel photos are required for AI analysis.');
    error.status = 400;
    throw error;
  }

  const manifest = (record.photoSteps || []).map((item) => `${item.key}: ${item.title}`).join('\n');
  const prompt = `You are analyzing photographs of one residential electrical panel for a professional panel directory.\n\nUse ALL photos together. The left and right close-ups may overlap. Deduplicate breakers seen in overlapping images. Use the full-panel overview to establish physical order and use the close-ups to read breaker handles, breaker markings, and stickers or handwritten circuit descriptions beside each breaker.\n\nNever invent a circuit description, amperage, breaker type, manufacturer, or position. If text or a breaker is unclear, leave nullable fields null, use an empty description when unreadable, reduce confidence, and set needsReview=true. Treat odd-numbered circuits as the left side and even-numbered circuits as the right side when the physical panel follows that standard; if the photos clearly show a different numbering scheme, follow what is visible. For 2-pole breakers, identify the first circuit position and poles=2.\n\nNormalize breakerType to standard, afci, gfci, dual, surge, or unknown. Preserve useful circuit wording from stickers, but clean obvious OCR noise and capitalization.\n\nPanel setup supplied by technician:\n${JSON.stringify(record.panel || {})}\n\nPhoto manifest:\n${manifest}\n\nReturn the complete best proposed directory and flag every uncertain item for human verification.`;

  const body = {
    model: process.env.OPENAI_PANEL_MODEL || 'gpt-5.6-terra',
    reasoning: { effort: 'medium' },
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...files.map(imagePart),
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'panel_directory_analysis',
        strict: true,
        schema: panelSchema,
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || `OpenAI returned ${response.status}.`);
    error.status = response.status;
    error.code = data?.error?.code || 'OPENAI_ERROR';
    throw error;
  }
  const text = parseResponseText(data);
  if (!text) throw new Error('OpenAI returned no panel analysis.');
  let analysis;
  try { analysis = JSON.parse(text); }
  catch { throw new Error('OpenAI panel analysis was not valid JSON.'); }
  return {
    analysis,
    model: data.model || body.model,
    responseId: data.id || null,
  };
}
