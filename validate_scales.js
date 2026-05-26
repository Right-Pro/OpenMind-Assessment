const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

const scaleSchema = {
  type: 'object',
  required: ['id', 'name', 'description', 'version', 'category', 'questions', 'scoring', 'interpretation', 'settings', 'reportTemplate'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    category: { type: 'string', enum: ['mood', 'personality', 'psychiatric', 'cognitive', 'screening', 'other'] },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'options'],
        properties: {
          id: {},
          text: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['label', 'value', 'score'],
              properties: {
                label: { type: 'string' },
                value: {},
                score: { type: 'number' }
              }
            }
          }
        }
      }
    },
    scoring: { type: 'object' },
    interpretation: { type: 'object' },
    settings: { type: 'object' },
    reportTemplate: { type: 'object' }
  }
};

const validateScale = ajv.compile(scaleSchema);

const list = [
  'YMRS', 'IES-R', 'BIS-11', 'CGI', 'PHQ-15', 'Y-BOCS-SR', 'OCI-R', 'DES-II', 'BHS', 'BSS',
  'AIS', 'DUDIT', 'FTND', 'SERS', 'DSQ', 'PDQ-4+', 'ADL', 'SDS-Sheehan', 'MGH-CPFQ', 'TAS'
];

let allValid = true;

list.forEach(name => {
  const filePath = path.join(__dirname, 'resources', 'scales', name + '.json');
  if (!fs.existsSync(filePath)) {
    console.error(`File does not exist: ${filePath}`);
    allValid = false;
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const valid = validateScale(data);
    if (!valid) {
      console.log(`\n--- Scale ${name}.json has validation errors: ---`);
      console.log(JSON.stringify(validateScale.errors, null, 2));
      allValid = false;
    } else {
      console.log(`Scale ${name}.json is VALID.`);
    }
  } catch (err) {
    console.error(`Error parsing/validating ${name}: ${err.message}`);
    allValid = false;
  }
});

if (allValid) {
  console.log('\nSUCCESS: All 20 scales passed schema validation.');
} else {
  console.log('\nFAILURE: Schema validation failed on some scales.');
}
