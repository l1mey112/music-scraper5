#include <math.h>
#include <sqlite3.h>
#include <sqlite3ext.h>
SQLITE_EXTENSION_INIT1
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// no stdbit :(
// #include <stdbit.h>

#define popcnt(x) __builtin_popcount(x)

#define MATCH_BITS 14
#define MATCH_MASK ((1 << MATCH_BITS) - 1)
#define MATCH_STRIP(x) ((uint32_t)(x) >> (32 - MATCH_BITS))

#define UNIQ_BITS 16
#define UNIQ_MASK ((1 << MATCH_BITS) - 1)
#define UNIQ_STRIP(x) ((uint32_t)(x) >> (32 - MATCH_BITS))

static inline int imin(int a, int b) {
	return a < b ? a : b;
}

static inline int imax(int a, int b) {
	return a > b ? a : b;
}

static inline void *sqlite3_malloc0(int size) {
	void *ptr = sqlite3_malloc(size);
	if (ptr) {
		memset(ptr, 0, size);
	}
	return ptr;
}

// ported from https://github.com/acoustid/pg_acoustid to sqlite3
static void acoustid_compare2(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
	int atype = sqlite3_value_type(argv[0]);
	int btype = sqlite3_value_type(argv[1]);

	if (atype == SQLITE_NULL || btype == SQLITE_NULL) {
		sqlite3_result_null(ctx);
		return;
	}

	if ((atype != SQLITE_TEXT && atype != SQLITE_BLOB) || (btype != SQLITE_TEXT && btype != SQLITE_BLOB)) {
		sqlite3_result_error(ctx, "parameters 0 and 1 must be blob or text", -1);
		return;
	}

	int asize_bytes = sqlite3_value_bytes(argv[0]);
	int bsize_bytes = sqlite3_value_bytes(argv[1]);

	// NULL on empty string
	const int32_t *a = (const int32_t*)sqlite3_value_blob(argv[0]);
	const int32_t *b = (const int32_t*)sqlite3_value_blob(argv[1]);
	int maxoffset = sqlite3_value_int(argv[2]);

	// not right size
	if ((asize_bytes & 3) != 0 || (bsize_bytes & 3) != 0) {
		sqlite3_result_error(ctx, "blob parameters must be uint32 arrays (multiple of 4)", -1);
		return;
	}

	int asize = asize_bytes / 4;
	int bsize = bsize_bytes / 4;

	int numcounts = asize + bsize + 1;
	uint16_t *counts = sqlite3_malloc0(numcounts * sizeof(uint16_t));

	uint16_t *aoffsets = sqlite3_malloc0(sizeof(uint16_t) * (MATCH_MASK + 1) * 2);
	uint16_t *boffsets = aoffsets + MATCH_MASK + 1;
	uint8_t *seen = (uint8_t*)aoffsets;

	if (!aoffsets || !counts) {
		sqlite3_result_error_nomem(ctx);
		goto dealloc;
	}

	float score;

	for (int i = 0; i < asize; i++) {
		aoffsets[MATCH_STRIP(a[i])] = i;
	}
	for (int i = 0; i < bsize; i++) {
		boffsets[MATCH_STRIP(b[i])] = i;
	}

	int topcount = 0;
	int topoffset = 0;
	for (int i = 0; i < MATCH_MASK; i++) {
		if (aoffsets[i] && boffsets[i]) {
			int offset = aoffsets[i] - boffsets[i];
			if (maxoffset == 0 || (-maxoffset <= offset && offset <= maxoffset)) {
				offset += bsize;
				counts[offset]++;
				if (counts[offset] > topcount) {
					topcount = counts[offset];
					topoffset = offset;
				}
			}
		}
	}

	topoffset -= bsize;

	int minsize = imin(asize, bsize) & ~1;
	if (topoffset < 0) {
		b -= topoffset;
		bsize = imax(0, bsize + topoffset);
	} else {
		a += topoffset;
		asize = imax(0, asize - topoffset);
	}

	int size = imin(asize, bsize) / 2;
	if (!size || !minsize) {
		sqlite3_log(SQLITE_OK, "acoustid_compare2: empty matching subfingerprint");
		score = 0.0;
		goto score;
	}

	int auniq = 0;
	int buniq = 0;

	memset(seen, 0, UNIQ_MASK);
	for (int i = 0; i < asize; i++) {
		int key = UNIQ_STRIP(a[i]);
		if (!seen[key]) {
			auniq++;
			seen[key] = 1;
		}
	}

	memset(seen, 0, UNIQ_MASK);
	for (int i = 0; i < bsize; i++) {
		int key = UNIQ_STRIP(b[i]);
		if (!seen[key]) {
			buniq++;
			seen[key] = 1;
		}
	}

	float diversity = fminf(fminf(1.0, (float)(auniq + 10) / asize + 0.5), fminf(1.0, (float)(buniq + 10) / bsize + 0.5));

	sqlite3_log(SQLITE_OK, "acoustid_compare2: offset %d, offset score %d, size %d, uniq size %d, diversity %f", topoffset, topcount, size * 2, imax(auniq, buniq), diversity);

	if (topcount < imax(auniq, buniq) * 0.02) {
		sqlite3_log(SQLITE_OK, "acoustid_compare2: top offset score is below 2%% of the unique size");
		score = 0.0;
		goto score;
	}

	uint64_t *adata = (uint64_t *)a;
	uint64_t *bdata = (uint64_t *)b;
	int biterror = 0;
	for (int i = 0; i < size; i++, adata++, bdata++) {
		biterror += popcnt(*adata ^ *bdata);
	}
	score = (size * 2.0 / minsize) * (1.0 - 2.0 * biterror / (64 * size));
	if (score < 0.0) {
		score = 0.0;
	}
	if (diversity < 1.0) {
		float newscore = powf(score, 8.0 - 7.0 * diversity);
		sqlite3_log(SQLITE_OK, "acoustid_compare2: scaling score because of duplicate items, %f => %f", score, newscore);
		score = newscore;
	}
score:
	sqlite3_result_double(ctx, score);
dealloc:
	sqlite3_free(aoffsets);
	sqlite3_free(counts);
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_chromaprint_init(sqlite3 *db, char **pz_err_msg, const sqlite3_api_routines *p_api) {
	SQLITE_EXTENSION_INIT2(p_api)
	sqlite3_create_function(db, "acoustid_compare2", 3, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, acoustid_compare2, NULL, NULL);
	return SQLITE_OK;
}
