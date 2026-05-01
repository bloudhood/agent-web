'use strict';

const fs = require('fs');

function buildHermesResponseInput(textValue, attachments = []) {
  const safeAttachments = Array.isArray(attachments) ? attachments.filter((attachment) => attachment?.path) : [];
  if (safeAttachments.length === 0) return textValue;
  const content = [];
  if (textValue) content.push({ type: 'input_text', text: textValue });
  for (const attachment of safeAttachments) {
    const data = fs.readFileSync(attachment.path).toString('base64');
    content.push({
      type: 'input_image',
      image_url: `data:${attachment.mime || 'image/png'};base64,${data}`,
    });
  }
  return [{ role: 'user', content }];
}

module.exports = { buildHermesResponseInput };
