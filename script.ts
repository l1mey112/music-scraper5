import { db } from "./db"
import { $locale } from "./schema"
import { KV, exhaustive_keyof } from "./types"

/* const script_languages = {
	latin: /[\u0041-\u005A\u0061-\u007A\u00AA\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u01BA\u01BB\u01BC-\u01BF\u01C0-\u01C3\u01C4-\u0293\u0294\u0295-\u02AF\u02B0-\u02B8\u02E0-\u02E4\u1D00-\u1D25\u1D2C-\u1D5C\u1D62-\u1D65\u1D6B-\u1D77\u1D79-\u1D9A\u1D9B-\u1DBE\u1E00-\u1EFF\u2071\u207F\u2090-\u209C\u212A-\u212B\u2132\u214E\u2160-\u2182\u2183-\u2184\u2185-\u2188\u2C60-\u2C7B\u2C7C-\u2C7D\u2C7E-\u2C7F\uA722-\uA76F\uA770\uA771-\uA787\uA78B-\uA78E\uA78F\uA790-\uA7CA\uA7D0-\uA7D1\uA7D3\uA7D5-\uA7D9\uA7F2-\uA7F4\uA7F5-\uA7F6\uA7F7\uA7F8-\uA7F9\uA7FA\uA7FB-\uA7FF\uAB30-\uAB5A\uAB5C-\uAB5F\uAB60-\uAB64\uAB66-\uAB68\uAB69\uFB00-\uFB06\uFF21-\uFF3A\uFF41-\uFF5A\u10780-\u10785\u10787-\u107B0\u107B2-\u107BA\u1DF00-\u1DF09\u1DF0A\u1DF0B-\u1DF1E\u1DF25-\u1DF2A]/g,
	japanese: /[\u3041-\u3096\u30A0-\u30FF\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A\u2E80-\u2FD5\uFF5F-\uFF9F\u3000-\u303F\u31F0-\u31FF\u3220-\u3243\u3280-\u337F]/g,
	chinese: /[\u2E80-\u2FD5\u3190-\u319f\u3400-\u4DBF\u4E00-\u9FCC\uF900-\uFAAD]/g,
	cyrillic: /[\u0400-\u0481\u0482\u0483-\u0484\u0487\u0488-\u0489\u048A-\u052F\u1C80-\u1C88\u1D2B\u1D78\u2DE0-\u2DFF\uA640-\uA66D\uA66E\uA66F\uA670-\uA672\uA673\uA674-\uA67D\uA67E\uA67F\uA680-\uA69B\uA69C-\uA69D\uA69E-\uA69F\uFE2E-\uFE2F\u1E030-\u1E06D\u1E08F]/g,
} */

/* const script_languages = {
	latin: /\p{sc=Latin}/g,
	japanese: /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}|\p{Script=Halfwidth_And_Fullwidth_Forms}/gu,
	chinese: /\p{Script=Han}/gu,
	cyrillic: /\p{Script=Cyrillic}/gu,
} */

export type Script = keyof typeof script_languages

const script_languages_similar: KV<Script, Script> = {
	chinese: 'japanese',
	japanese: 'chinese',
}

// TODO: for better identification


// classify based on MOST characters in the string
// default script is latin
export function script_classify(text: string): string {
	let scripts: Script[] = []

	let max = 0
	for (const [name, pattern] of exhaustive_keyof(script_languages)) {
		const count = (text.match(pattern) || []).length
		if (count > 0) {
			const similar = script_languages_similar[name]
			if (similar && scripts.includes(similar)) {
				continue
			}
			scripts.push(name)
		}
	}
	scripts = scripts || ['latin']
	return scripts.join('-')
}


const g = db.select()
	.from($locale)
	.all()

for (const k of g) {
	console.log(script_classify(k.text), k.text)
}