import { sqlite } from "../db"
import { assert, ident_classify, ident_id, merge } from "../pass_misc"
import { Ident } from "../types"
import { BoxBare, IdentTooltip, TooltipIdent } from "./Box"
import { htmx } from "./ui"

type Kind = 'similar_names_ar_al' | 'similar_names_tr'

type Pair = { a: Ident, a_name: string, b: Ident, b_name: string }
type BarePair = { a: Ident, b: Ident }

const similar_ident_prefix = (prefix: string) => `
	select distinct a.ident as a, a.text as a_name, b.ident as b, b.text as b_name
	from locale a
	inner join locale b on a.ident < b.ident
	where a.desc = 0 and b.desc = 0
	and a.ident glob '${prefix}*' and b.ident glob '${prefix}*'
	and a.text like ('%' || b.text || '%')
`

// no memo needed for this
const query_similar_names_ar_al = sqlite.prepare<Pair, []>(`
	${similar_ident_prefix('ar')}
	union all
	${similar_ident_prefix('al')}
`)

let query_similar_names_tr_stmt_memo: Pair[] | null = null
const query_similar_names_tr_stmt = sqlite.prepare<Pair, []>(`
	${similar_ident_prefix('tr')}
`)

function query_similar_names_tr_memo_remove(pair: BarePair) {
	query_similar_names_tr_stmt_memo = query_similar_names_tr_stmt_memo!.filter(p => p.a !== pair.a && p.b !== pair.b)
}

// use a memo
function query_similar_names_tr_memo() {
	if (query_similar_names_tr_stmt_memo === null) {
		query_similar_names_tr_stmt_memo = query_similar_names_tr_stmt.all()
	}
	return query_similar_names_tr_stmt_memo
}

export function route_mergetwo(kind: Kind, a: Ident, b: Ident) {
	const ident_kind = ident_classify(a)
	assert(ident_kind === ident_classify(b))
	
	console.log(a, b)

	const id1 = ident_id(a)
	const id2 = ident_id(b)
	merge(ident_kind, id1, id2)

	if (ident_kind == 'track_id') {
		query_similar_names_tr_memo_remove({ a, b })
	}

	route_mergeassist(kind)
}

export function route_mergeassist(kind: Kind = 'similar_names_ar_al') {
	let pairs: Pair[]

	switch (kind) {
		case 'similar_names_ar_al': {
			pairs = query_similar_names_ar_al.all()
			break
		}
		case 'similar_names_tr': {
			pairs = query_similar_names_tr_memo()
			break
		}
		default: {
			assert(false)
		}
	}

	const boxes: JSX.Element[] = []

	for (const { a, a_name, b, b_name } of pairs) {
		const line = <>
			<pre>{a_name} merge with {b_name}</pre>
			<b>{IdentTooltip(a)} and {IdentTooltip(b)}</b>
		</>

		const hx_vals = JSON.stringify({ kind, a, b })

		const corner = <pre style="padding: 1em; cursor: pointer;" class="box" hx-post="/mergetwo" hx-swap="none" hx-vals={hx_vals} hx-trigger="click">
			merge
		</pre>

		const left_and_right = <>
			{TooltipIdent(a, a_name)} with {TooltipIdent(b, b_name)}
		</>

		const box = BoxBare({
			line,
			corner,
			collaborators: left_and_right,
		})

		boxes.push(box)
	}

	const output = <div id="search-results" class="flex-container">
		{...boxes}
	</div>

	htmx(output)
}
