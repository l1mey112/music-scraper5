export const nfetch: typeof fetch = (url, init) => {
	// append header

	if (!init) {
		init = {};
	}

	if (!init.headers) {
		init.headers = {};
	}

	const headers = new Headers(init.headers)
	headers.set('User-Agent', "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/63.0.3239.84 TV Safari/537.36")

	init.headers = headers
	
	return fetch(url, init)
}
