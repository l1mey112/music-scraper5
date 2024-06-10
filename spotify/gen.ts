import { assert } from "../pass_misc"
import name_markov from "../vendor/name_markov"

const choice = <T>(array: T[]) => array[Math.floor(Math.random() * array.length)]
const randint = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const randintpad2 = (min: number, max: number) => {
	const num = randint(min, max)
	return num < 10 ? '0' + num : num.toString()
}

const randempty = (v: string) => {
	if (Math.random() < 0.5) {
		return ''
	}
	return v
}

// a-zA-Z0-9
const randchars = (length: number) => {
	const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
	let result = ''
	for (let i = 0; i < length; i++) {
		result += chars[Math.floor(Math.random() * chars.length)]
	}
	return result
}

const randhex = (length: number) => {
	const chars = '0123456789abcdef'
	let result = ''
	for (let i = 0; i < length; i++) {
		result += chars[Math.floor(Math.random() * chars.length)]
	}
	return result
}

export async function spotify_generate(): Promise<[username: string, password: string]> {
	while (true) {
		const nick = name_markov()
		const email = nick.toLowerCase() + randchars(randint(8, 10)) + '@gmail.com'
		const passw = randchars(randint(10, 18)) + 'Aa1!'

		const language = choice(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'nl-NL', 'ru-RU', 'zh-CN'])
		const android_model = choice(['SM-A205U', 'SM-N976N', 'SM-A102U', 'SM-G960U', 'SM-N960U', 'LM-Q720', 'LM-X420', 'LM-Q710', 'LG-M255'])
		const android_version = choice(['29', '28', '27', '26', '25'])

		const client_token = await crsf_token()

		const body = new URLSearchParams({
			'creation_point': 'client_mobile',
			'gender': choice(['male', 'female']),
			'birth_year': `${randint(1910, 2004)}`,
			'displayname': nick,
			'iagree': 'true',
			'birth_month': `${randint(1, 12)}`,
			'password_repeat': passw,
			'password': passw,
			'key': '142b583129b2df829de3656f9eb484e6',
			'platform': 'Android-ARM',
			'email': email,
			'birth_day': `${randint(1, 28)}`,
		})

		try {
			const res = await fetch(`https://spclient.wg.spotify.com/signup/public/v1/account?${body.toString()}`, {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Accept-Encoding': 'gzip',
					'Accept-Language': language + ';q=0.5' + randempty(', en;q=0.3'),
					'App-Platform': 'Android',
					'Connection': 'Keep-Alive',
					'Content-Type': 'application/x-www-form-urlencoded',
					'Host': 'spclient.wg.spotify.com',
					'User-Agent': `Spotify/8.6.72 Android/${android_version} (${android_model})`,
					'Spotify-App-Version': '8.6.72',
					'X-Client-Id': '142b583129b2df829de3656f9eb484e6',
					'Client-Token': client_token,
				},
			})

			const json = await res.json() as { status: number | string }
			if (res.ok && json['status'] == 1) {
				return [email, passw]
			} else {
				console.error('spotify_generate(fail):', json)
			}
		} catch (e) {
			console.error('spotify_generate(fail):', e)
		}
	}
}

async function crsf_token() {
	const payload = {
		'client_data': {
			'client_id': 'd8a5ed958d274c2e8ee717e6a4b0971d',
			'client_version': '1.2.10.278.g261ea664',
			'js_sdk_data': {
				'device_brand': 'unknown',
				'device_model': 'desktop',
				'os': 'Windows',
				'os_version': 'NT 10.0',
			}
		}
	}

	try {
		const response = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
			method: 'POST',
			body: JSON.stringify(payload),
			headers: {
				'Host': 'clienttoken.spotify.com',
				'Accept': 'application/json',
				'Accept-Language': 'tr-TR,trq=0.8,en-USq=0.5,enq=0.3',
				'Accept-Encoding': 'gzip, deflate, br',
				'Content-Type': 'application/json',
				'Origin': 'https://open.spotify.com',
				'Sec-Fetch-Dest': 'empty',
				'Sec-Fetch-Mode': 'cors',
				'Sec-Fetch-Site': 'same-site',
				'Referer': 'https://open.spotify.com/',
				'Connection': 'keep-alive',
				'TE': 'trailers',
			},
		})

		if (response.ok) {
			type Resp = {
				granted_token: {
					token: string
				}
			}

			const data = await response.json() as Resp
			return data.granted_token.token
		} else {
			throw new Error('response not ok')
		}
	} catch (e) {
		assert(false, `Failed to get CSRF token (${e})`)
	}
}

/* export async function spotify_generate(): Promise<[username: string, password: string]> {
	while (true) {
		const nick = name_markov()
		const email = nick.toLowerCase() + '@gmail.com'
		const passw = randchars(randint(8, 18))

		const language = choice(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'nl-NL', 'ru-RU', 'zh-CN'])

		const client_token = await crsf_token()
		console.log('client_token:', client_token)

		const payload = {
			'account_details': {
				'birthdate': `${randint(1910, 2004)}-${randintpad2(1, 12)}-${randintpad2(1, 28)}`,
				'consent_flags': {
					'eula_agreed': true,
					'send_email': true,
					'third_party_email': true,
				},
				'display_name': nick,
				'email_and_password_identifier': {
					'email': email,
					'password': passw,
				},
				'gender': randint(1, 2),
			},
			'callback_uri': 'https://auth-callback.spotify.com/r/android/music/signup',
			'client_info': {
				'api_key': '142b583129b2df829de3656f9eb484e6',
				'app_version': 'v2',
				'capabilities': [1],
				'installation_id': crypto.randomUUID(),
				'platform': 'Android-ARM',
			},
			'tracking': {
				'creation_flow': '',
				'creation_point': 'client_mobile',
				'referrer': '',
			}
		}

		console.log('payload:', payload)

		try {
			const res = await fetch(`https://spclient.wg.spotify.com/signup/public/v2/account/create`, {
				method: 'POST',
				body: JSON.stringify(payload),
				headers: {
					'Accept-Encoding': 'gzip',
					'Accept-Language': language + ';q=0.5' + randempty(', en;q=0.3'),
					'Content-Type': 'application/json',
					'app-platform': 'Android',
					'client-token': client_token,
					'Connection': 'Keep-Alive',
					'Origin': 'https://www.spotify.com',
					'Host': 'spclient.wg.spotify.com',
					'spotify-app-version': '8.8.0.347',
					'User-Agent': 'Spotify/8.8.0.347 Android/25 (SM-G988N)',
					'x-client-id': crypto.randomUUID().replace(/-/g, ''),
				}
			})

			console.log('res:', res)

			if (res.ok) {
				console.log(await res.text())
				return
			}
		} catch {
			// pass
		}
		console.error('spotify_generate(fail)')

		break
	}
} */

/*

// https://github.com/samipmainali/SpotGen-Spotify-Account-Generator/blob/master/Modules/Accountgenerator.cs

```proto
syntax = "proto3";

message SignUpRequest {
	string url = 1;
	UserInfo tag2 = 2;
	DeviceInfo tag3 = 3;
	Client tag4 = 4;
}

message UserInfo {
	string username = 1;
	string dob = 2;
	int32 gender = 3;
	BlankVariant tag4 = 4;
	SignUpCredentials tag101 = 101;
}

message BlankVariant {
	BlankVariantTag1 tag1 = 1;
	BlankVariantTag2 tag2 = 3;
	BlankVariantTag3 tag3 = 4;
}

message BlankVariantTag1 {
	int32 blank_tag1 = 1;
}

message BlankVariantTag2 {
	// Empty message
}

message BlankVariantTag3 {
	// Empty message
}

message SignUpCredentials {
	string signupemail = 1;
	string password = 2;
}

message DeviceInfo {
	string client_id = 1;
	string os = 2;
	string appversion = 3;
	int32 stringoffset = 4;
	string random_hex32 = 5;
}

message Client {
	string client_mobile = 1;
}

message SignUpResponse {
	UsernameAndLogin username_and_login = 1;
	string creation_id = 4;
}

message UsernameAndLogin {
	string username = 1;
	string login_token = 2;
}
```

// BELOW RETURNS A CHALLENGE ID etc, needs captcha solving

import { load } from 'protobufjs'

const sp = await load(`${import.meta.dir}/sp.proto`)
const sp_signup = sp.lookupType('SignUpRequest')

export async function spotify_generate(): Promise<[username: string, password: string]> {
	while (true) {
		const nick = name_markov()
		const email = nick.toLowerCase() + randchars(randint(6, 8)) + '@gmail.com'
		const passw = randchars(randint(10, 18))
		const language = choice(['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'nl-NL', 'ru-RU', 'zh-CN'])

		const msg = {
			url: 'https://auth-callback.spotify.com/r/ios/music/signup',
			tag2: {
				username: nick,
				dob: `${randint(1910, 2004)}-${randintpad2(1, 12)}-${randintpad2(1, 28)}`,
				gender: randint(1, 2),
				tag4: {
					tag1: {
						blankTag1: 1 // terms and conditions
					},
					tag2: {},
					tag3: {},
				},
				tag101: {
					signupemail: email,
					password: passw,
				},
			},
			tag3: {
				clientId: 'bff58e9698f40080ec4f9ad97a2f21e0',
				os: 'iOS-ARM',
				appversion: '8.8.54',
				stringoffset: 1,
				randomHex32: randhex(32),
			},
			tag4: {
				clientMobile: 'client_mobile',
			},
		}

		const message = sp_signup.fromObject(msg)
		const buf = sp_signup.encode(message).finish()

		const client_token = await crsf_token()
		try {
			const res = await fetch(`https://spclient.wg.spotify.com/signup/public/v2/account/create`, {
				method: 'POST',
				body: buf,
				headers: {
					'Accept': 'application/json',
					'Accept-Encoding': 'gzip',
					'Accept-Language': language + ';q=0.5' + randempty(', en;q=0.3'),
					'Content-Type': 'application/protobuf',
					'App-Platform': 'iOS',
					'Connection': 'Keep-Alive',
					'Host': 'spclient.wg.spotify.com',
					'Spotify-App-Version': '8.8.54.544',
					'User-Agent': 'Spotify/8.8.54iOS/16.0.2(iPhone10,3)',
					'X-Client-Id': '58bd3c95768941ea9eb4350aaa033eb3',
					'Client-Token': client_token,
				}
			})

			console.log('res:', res)
			console.log('res:', await res.text())
			//console.log('res:', Buffer.from(await res.arrayBuffer()).toString('hex'))

			if (res.ok) {
				return [email, passw]
			}
		} catch (e) {
			// pass
		}

		console.error('spotify_generate(fail)')
	}
} */
