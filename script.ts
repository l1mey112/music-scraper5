import { exhaustive_keyof } from "./types"

const script_languages = {
	latin: /[\u{0041}-\u{005A}\u{0061}-\u{007A}\u{00AA}\u{00BA}\u{00C0}-\u{00D6}\u{00D8}-\u{00F6}\u{00F8}-\u{01BA}\u{01BB}\u{01BC}-\u{01BF}\u{01C0}-\u{01C3}\u{01C4}-\u{0293}\u{0294}\u{0295}-\u{02AF}\u{02B0}-\u{02B8}\u{02E0}-\u{02E4}\u{1D00}-\u{1D25}\u{1D2C}-\u{1D5C}\u{1D62}-\u{1D65}\u{1D6B}-\u{1D77}\u{1D79}-\u{1D9A}\u{1D9B}-\u{1DBE}\u{1E00}-\u{1EFF}\u{2071}\u{207F}\u{2090}-\u{209C}\u{212A}-\u{212B}\u{2132}\u{214E}\u{2160}-\u{2182}\u{2183}-\u{2184}\u{2185}-\u{2188}\u{2C60}-\u{2C7B}\u{2C7C}-\u{2C7D}\u{2C7E}-\u{2C7F}\u{A722}-\u{A76F}\u{A770}\u{A771}-\u{A787}\u{A78B}-\u{A78E}\u{A78F}\u{A790}-\u{A7CA}\u{A7D0}-\u{A7D1}\u{A7D3}\u{A7D5}-\u{A7D9}\u{A7F2}-\u{A7F4}\u{A7F5}-\u{A7F6}\u{A7F7}\u{A7F8}-\u{A7F9}\u{A7FA}\u{A7FB}-\u{A7FF}\u{AB30}-\u{AB5A}\u{AB5C}-\u{AB5F}\u{AB60}-\u{AB64}\u{AB66}-\u{AB68}\u{AB69}\u{FB00}-\u{FB06}\u{FF21}-\u{FF3A}\u{FF41}-\u{FF5A}\u{10780}-\u{10785}\u{10787}-\u{107B0}\u{107B2}-\u{107BA}\u{1DF00}-\u{1DF09}\u{1DF0A}\u{1DF0B}-\u{1DF1E}\u{1DF25}-\u{1DF2A}]/g,
	japanese: /[\u{3041}-\u{3096}\u{30A0}-\u{30FF}\u{3400}-\u{4DB5}\u{4E00}-\u{9FCB}\u{F900}-\u{FA6A}\u{2E80}-\u{2FD5}\u{FF5F}-\u{FF9F}\u{3000}-\u{303F}\u{31F0}-\u{31FF}\u{3220}-\u{3243}\u{3280}-\u{337F}]/g,
	chinese: /[\u{2E80}-\u{2FD5}\u{3190}-\u{319f}\u{3400}-\u{4DBF}\u{4E00}-\u{9FCC}\u{F900}-\u{FAAD}]/g,
	cyrillic: /[\u{0400}-\u{0481}\u{0482}\u{0483}-\u{0484}\u{0487}\u{0488}-\u{0489}\u{048A}-\u{052F}\u{1C80}-\u{1C88}\u{1D2B}\u{1D78}\u{2DE0}-\u{2DFF}\u{A640}-\u{A66D}\u{A66E}\u{A66F}\u{A670}-\u{A672}\u{A673}\u{A674}-\u{A67D}\u{A67E}\u{A67F}\u{A680}-\u{A69B}\u{A69C}-\u{A69D}\u{A69E}-\u{A69F}\u{FE2E}-\u{FE2F}\u{1E030}-\u{1E06D}\u{1E08F}]/g,
}

// TODO: for better identification

export type Script = keyof typeof script_languages

// classify based on MOST characters in the string
// default script is latin
export function script_classify(text: string): Script {
	let script: Script = 'latin'
	let max = 0
	for (const [name, pattern] of exhaustive_keyof(script_languages)) {
		const count = (text.match(pattern) || []).length
		if (count > max) {
			script = name
			max = count
		}
	}
	return script
}
