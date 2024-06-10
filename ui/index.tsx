import { htmx } from "./ui"

let page: 'search' | 'search_tooltip_link' | 'mergeassist' = 'search'

function PageSelect() {
	return <div hx-swap="none">
		<input type="button" hx-post="/page?p=search" hx-trigger="click" value="Search" />
		<input type="button" hx-post="/page?p=mergeassist" hx-trigger="click" value="Merge Assist" />
		<br />
	</div>
}

export function Index() {
	switch (page) {
		case 'search': {
			return <div id="index">
				{PageSelect()}
				<div class="box">
					<form hx-swap="none">
						<input type="search" name="search" placeholder="Search..."
							hx-trigger="input changed delay:100ms, search, load"
							hx-post="/search" />
						<select hx-trigger="input" hx-post="/search" name="kind">
							<option value="track">Track</option>
							<option value="track_by_artists">Track By Artists</option>
							<option value="album">Album</option>
							<option value="artist">Artist</option>
							<option value="ident">Ident</option>
						</select>
					</form>
				</div>
				<div id="select-results"></div>
				<hr />
				<div id="search-results" class="flex-container"></div>
			</div>
		}
		// everything but the on load trigger
		case 'search_tooltip_link': {
			return <div id="index">
				{PageSelect()}
				<div class="box">
					<form hx-swap="none">
						<input type="search" name="search" placeholder="Search..."
							hx-trigger="input changed delay:100ms, search"
							hx-post="/search" />
						<select hx-trigger="input" hx-post="/search" name="kind">
							<option value="track">Track</option>
							<option value="track_by_artists">Track By Artists</option>
							<option value="album">Album</option>
							<option value="artist">Artist</option>
							<option value="ident">Ident</option>
						</select>
					</form>
				</div>
				<div id="select-results"></div>
				<hr />
				<div id="search-results" class="flex-container"></div>
			</div>
		}
		case 'mergeassist': {
			return <div id="index">
				{PageSelect()}
				<div class="box">
					<form hx-swap="none">
						<select id="mergeassist_selector" hx-trigger="input, load" hx-post="/mergeassist" name="kind">
							<option value="similar_names_ar_al">Similar Names (Artists + Albums)</option>
							<option value="similar_names_tr">Similar Names (Track, will be slow)</option>
						</select>
					</form>
				</div>
				<hr />
				<div id="search-results" class="flex-container"></div>
			</div>
		}
	}
}

export function switch_page(npage: typeof page) {
	page = npage
	htmx(Index())
}
