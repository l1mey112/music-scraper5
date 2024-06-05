import name_markov from "../vendor/name_markov"

export async function spotify_generate(): Promise<[username: string, password: string]> {
	const choice = <T>(array: T[]) => array[Math.floor(Math.random() * array.length)]
	const randint = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
	
	// a-zA-Z0-9
	const randchars = (length: number) => {
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
		let result = ''
		for (let i = 0; i < length; i++) {
			result += chars[Math.floor(Math.random() * chars.length)]
		}
		return result
	}

	while (true) {
		const nick = name_markov()
		const email = nick.toLowerCase() + '@gmail.com'
		const passw = randchars(randint(8, 18))

		const language = choice(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'nl-NL', 'ru-RU', 'zh-CN'])
		const android_model = choice(['SM-A205U', 'SM-N976N', 'SM-A102U', 'SM-G960U', 'SM-N960U', 'LM-Q720', 'LM-X420', 'LM-Q710', 'LG-M255'])
		const android_version = choice(['29', '28', '27', '26', '25'])

		const body = new URLSearchParams({
			'creation_point': 'client_mobile',
			'gender': choice(['male', 'female']),
			'birth_year': `${randint(1990, 2000)}`,
			'displayname': nick,
			'iagree': 'true',
			'birth_month': `${randint(1, 11)}`,
			'password_repeat': passw,
			'password': passw,
			'key': '142b583129b2df829de3656f9eb484e6',
			'platform': 'Android-ARM',
			'email': email,
			'birth_day': `${randint(1, 20)}`,
		})

		try {
			const res = await fetch(`https://spclient.wg.spotify.com/signup/public/v1/account?${body.toString()}`, {
				method: 'POST',
				headers: {
					'Accept-Encoding': 'gzip',
					'Accept-Language': language,
					'App-Platform': 'Android',
					'Connection': 'Keep-Alive',
					'Content-Type': 'application/x-www-form-urlencoded',
					'Host': 'spclient.wg.spotify.com',
					'User-Agent': `Spotify/8.6.72 Android/${android_version} (${android_model})`,
					'Spotify-App-Version': '8.6.72',
				}
			})

			const json = await res.json() as { status: number | string }
			if (res.ok && json['status'] == 1) {
				return [email, passw]
			}
		} catch (e) {
			console.error('spotify_generate(fail):', e)
		}
	}
}
