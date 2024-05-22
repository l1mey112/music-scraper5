#include "lib.h"
#include <sqlite3.h>
#include <sqlite3ext.h>
SQLITE_EXTENSION_INIT1
#include <stdint.h>
#include <string.h>

static inline void *sqlite3_malloc0(size_t size) {
	void *ptr = sqlite3_malloc(size);
	if (ptr) {
		memset(ptr, 0, size);
	}
	return ptr;
}

static void sqlite3_acoustid_compare2(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
	(void)argc;
	
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

	float outp;
	int rc = acoustid_compare2(a, asize_bytes / 4, b, bsize_bytes / 4, maxoffset, &outp, sqlite3_malloc0, sqlite3_free);

	if (rc < 0) {
		sqlite3_result_error_nomem(ctx);
		return;
	}

	sqlite3_result_double(ctx, outp);
}

static void sqlite3_simhash32(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
	(void)argc;

	int atype = sqlite3_value_type(argv[0]);

	if (atype == SQLITE_NULL) {
		sqlite3_result_null(ctx);
		return;
	}

	unsigned size_bytes = sqlite3_value_bytes(argv[0]);
	if ((size_bytes & 3) != 0) {
		sqlite3_result_error(ctx, "blob parameter must be uint32 array (multiple of 4)", -1);
		return;
	}

	const uint32_t *a = (const uint32_t*)sqlite3_value_blob(argv[0]);
	sqlite3_result_int(ctx, simhash32(a, size_bytes / 4));
}

static void sqlite3_hdist32(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
	(void)argc;
	unsigned a = sqlite3_value_int(argv[0]);
	unsigned b = sqlite3_value_int(argv[1]);
	sqlite3_result_int(ctx, hdist32(a, b));
}

DLL_EXPORT
int sqlite3_ext_init(sqlite3 *db, char **pz_err_msg, const sqlite3_api_routines *p_api) {
	(void)pz_err_msg;
	SQLITE_EXTENSION_INIT2(p_api)
	sqlite3_create_function(db, "acoustid_compare2", 3, SQLITE_UTF8 | SQLITE_DETERMINISTIC | SQLITE_INNOCUOUS, NULL, sqlite3_acoustid_compare2, NULL, NULL);
	sqlite3_create_function(db, "simhash32", 1, SQLITE_UTF8 | SQLITE_DETERMINISTIC | SQLITE_INNOCUOUS, NULL, sqlite3_simhash32, NULL, NULL);
	sqlite3_create_function(db, "hdist32", 2, SQLITE_UTF8 | SQLITE_DETERMINISTIC | SQLITE_INNOCUOUS, NULL, sqlite3_hdist32, NULL, NULL);
	return SQLITE_OK;
}
