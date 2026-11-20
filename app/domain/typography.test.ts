import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { keepOneLetterWords } from './typography.ts'

describe('keepOneLetterWords', () => {
  it('ties a one-letter preposition or conjunction to the word after it', () => {
    assert.equal(keepOneLetterWords('Text pište v dokumentu.'), 'Text pište v dokumentu.')
    assert.equal(keepOneLetterWords('S pozdravem'), 'S pozdravem')
    assert.equal(keepOneLetterWords('k užití díla'), 'k užití díla')
  })

  it('ties each word of a run', () => {
    assert.equal(
      keepOneLetterWords('jazykovými a v tištěné i digitální'),
      'jazykovými a v tištěné i digitální',
    )
  })

  it('ties a word after an opening quote or a bracket', () => {
    assert.equal(keepOneLetterWords('„o čem“ (a proč)'), '„o čem“ (a proč)')
  })

  it('leaves an abbreviation and the end of a longer word alone', () => {
    assert.equal(keepOneLetterWords('Vedneměsíčník, z. s. IČO'), 'Vedneměsíčník, z. s. IČO')
    assert.equal(keepOneLetterWords('vás prosíme'), 'vás prosíme')
    assert.equal(keepOneLetterWords('Lucemburk v Praze'), 'Lucemburk v Praze')
  })

  it('changes nothing that is tied already', () => {
    let tied = keepOneLetterWords('v dokumentu u vašeho jména')
    assert.equal(keepOneLetterWords(tied), tied)
  })
})
