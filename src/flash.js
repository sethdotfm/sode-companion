// The short red word a refused press shows on its key. Keys are small, so the full sentence goes to the error variable.
const WORDS = {
  'no-destination': 'No dest',
  protected: 'Protected',
  'no-common-levels': 'No level',
  'outside-rights': 'Rights',
  'no-preset': 'No preset',
  'preset-multi': 'One dest',
  refused: 'Refused',
};

export const flashWord = (err) => WORDS[err?.code] || 'Refused';
