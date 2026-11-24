/*
 * OmniCalc Pro — motor de cálculo (C -> WebAssembly)
 * ---------------------------------------------------
 * Compilación "freestanding": sin libc, sin malloc/free y sin Emscripten.
 *
 *  - TODA la memoria es estática (buffers de tamaño fijo en la memoria lineal
 *    del módulo). No hay fugas, fragmentación ni doble-free posibles.
 *  - JS y C se comunican con UN puñado de buffers fijos cuyas direcciones se
 *    piden una sola vez al arrancar (oc_in, oc_out, oc_x, oc_y, oc_pts, ...).
 *  - Las funciones transcendentes (sin, exp, pow...) y el formateo de números
 *    los aporta el host (import "env"), igual que hace Emscripten con libm.
 *  - Las funciones devuelven códigos de error; nunca abortan ni se cuelgan.
 *
 * Convención de strings: JS escribe en oc_in() (UTF-8, terminado en NUL).
 * Si hay varios campos se separan con '\n'. C responde en oc_out() con líneas
 * separadas por '\n' y/o números en oc_aux().
 */

typedef unsigned char  u8;
typedef unsigned int   u32;
typedef unsigned long long u64;
typedef long long      i64;

#define EXPORT __attribute__((visibility("default"), used))
#define IMPORT(n) __attribute__((import_module("env"), import_name(#n)))

/* ---------- Funciones que aporta el host (JS) ---------- */
IMPORT(m_sin)   double m_sin(double);
IMPORT(m_cos)   double m_cos(double);
IMPORT(m_tan)   double m_tan(double);
IMPORT(m_asin)  double m_asin(double);
IMPORT(m_acos)  double m_acos(double);
IMPORT(m_atan)  double m_atan(double);
IMPORT(m_atan2) double m_atan2(double, double);
IMPORT(m_sinh)  double m_sinh(double);
IMPORT(m_cosh)  double m_cosh(double);
IMPORT(m_tanh)  double m_tanh(double);
IMPORT(m_exp)   double m_exp(double);
IMPORT(m_log)   double m_log(double);
IMPORT(m_log10) double m_log10(double);
IMPORT(m_log2)  double m_log2(double);
IMPORT(m_pow)   double m_pow(double, double);
IMPORT(m_cbrt)  double m_cbrt(double);
IMPORT(m_hypot) double m_hypot(double, double);
IMPORT(m_fmod)  double m_fmod(double, double);
IMPORT(h_fmt)   int    h_fmt(double v, char *out, int cap);   /* número -> texto */
IMPORT(h_num)   double h_num(const char *s, int len);         /* texto -> número exacto */

#define NAN_D   (__builtin_nan(""))
#define INF_D   (__builtin_inf())
#define fabs_d  __builtin_fabs
#define sqrt_d  __builtin_sqrt
#define floor_d __builtin_floor
#define ceil_d  __builtin_ceil
#define trunc_d __builtin_trunc

#define PI_D  3.14159265358979323846
#define E_D   2.71828182845904523536
#define PHI_D 1.61803398874989484820

static int is_nan(double x) { return x != x; }
static int is_fin(double x) { return x - x == 0.0; }

/* LLVM puede convertir comprobaciones de desbordamiento de 64 bits en una multiplicación de 128 bits.
 * Como no hay compiler-rt, aportamos __multi3 (algoritmo clásico de multiplicación por mitades de 32 bits). */
typedef __int128 ti_int;
typedef union { ti_int all; struct { u64 lo; u64 hi; } s; } twords;
__attribute__((used)) ti_int __multi3(ti_int a, ti_int b) {
    twords x, y, r; x.all = a; y.all = b;
    const u64 M = 0xFFFFFFFFULL;
    u64 al = x.s.lo & M, ah = x.s.lo >> 32, bl = y.s.lo & M, bh = y.s.lo >> 32;
    u64 t = al * bl; r.s.lo = t & M; u64 k = t >> 32;
    t = ah * bl + k; u64 w1 = t & M, w2 = t >> 32;
    t = al * bh + w1; k = t >> 32;
    r.s.lo |= t << 32;
    r.s.hi = ah * bh + w2 + k;
    r.s.hi += x.s.hi * y.s.lo + x.s.lo * y.s.hi;
    return r.all;
}

/* ---------- Buffers estáticos compartidos con JS ---------- */
#define IN_CAP   4096
#define OUT_CAP  32768
#define DATA_CAP 16384
#define PTS_CAP  4096
#define AUX_CAP  64
#define MAXN     5

static char   g_in[IN_CAP];
static char   g_out[OUT_CAP];
static double g_x[DATA_CAP];
static double g_y[DATA_CAP];
static double g_work[DATA_CAP];
static double g_pts[PTS_CAP];
static double g_aux[AUX_CAP];
static double g_mat[3][MAXN * MAXN];   /* 0 = A, 1 = B, 2 = resultado */

EXPORT char   *oc_in(void)   { return g_in; }
EXPORT char   *oc_out(void)  { return g_out; }
EXPORT double *oc_x(void)    { return g_x; }
EXPORT double *oc_y(void)    { return g_y; }
EXPORT double *oc_pts(void)  { return g_pts; }
EXPORT double *oc_aux(void)  { return g_aux; }
EXPORT double *oc_mat(void)  { return &g_mat[0][0]; }
EXPORT int oc_cap(int which) {
    switch (which) { case 0: return IN_CAP; case 1: return OUT_CAP; case 2: return DATA_CAP;
                     case 3: return PTS_CAP; case 4: return AUX_CAP; default: return MAXN; }
}
EXPORT int oc_version(void) { return 200; }

/* ---------- Utilidades de texto ---------- */
static int  is_digit(char c) { return c >= '0' && c <= '9'; }
static int  is_alpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
static char lc(char c)       { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }
static int  fend(char c)     { return c == 0 || c == '\n'; }

/* Devuelve el puntero al campo idx (separados por '\n') dentro de g_in */
static const char *field(int idx) {
    const char *p = g_in;
    while (idx > 0) {
        while (!fend(*p)) p++;
        if (!*p) return p;
        p++; idx--;
    }
    return p;
}

/* ---------- Escritor de salida con control de límites ---------- */
static int g_op;
static void o_reset(void) { g_op = 0; g_out[0] = 0; }
static void o_ch(char c)  { if (g_op < OUT_CAP - 1) { g_out[g_op++] = c; g_out[g_op] = 0; } }
static void o_s(const char *s) { while (*s) o_ch(*s++); }
static void o_nl(void)    { o_ch('\n'); }
static void o_u64(u64 v) {
    char t[24]; int i = 0;
    if (!v) t[i++] = '0';
    while (v) { t[i++] = (char)('0' + v % 10); v /= 10; }
    while (i) o_ch(t[--i]);
}
static void o_i64(i64 v) { if (v < 0) { o_ch('-'); o_u64(0 - (u64)v); } else o_u64((u64)v); }
static void o_num(double v) {
    char t[80]; int n = h_fmt(v, t, 80);
    if (n < 0) n = 0; if (n > 79) n = 79;
    for (int i = 0; i < n; i++) o_ch(t[i]);
}
static void o_pad(const char *s, int w) { int l = 0; while (s[l]) l++; for (int i = l; i < w; i++) o_ch(' '); o_s(s); }

/* ===================================================================
 *  1. PARSER MATEMÁTICO  (compilador a bytecode + máquina de pila)
 *     - Se compila UNA vez y se evalúa miles de veces (gráficas).
 *     - Gramática con precedencia correcta:  ! > ^ > unario > * / > + -
 *     - Multiplicación implícita:  2x, 3(x+1), 2pi, (a)(b), x sin(x)
 *     - Reentrante: sin variables globales de parseo.
 * =================================================================== */
#define SLOTS     8
#define MAX_INS   256
#define MAX_STACK 64
#define MAX_DEPTH 48

enum { OP_NUM, OP_X, OP_ADD, OP_SUB, OP_MUL, OP_DIV, OP_POW, OP_NEG, OP_F1, OP_F2, OP_FACT };
enum { F_SIN, F_COS, F_TAN, F_ASIN, F_ACOS, F_ATAN, F_SINH, F_COSH, F_TANH, F_SQRT, F_CBRT,
       F_LN, F_LOG, F_LOG2, F_EXP, F_ABS, F_FLOOR, F_CEIL, F_ROUND, F_SIGN, F_FACT, F_ASINH, F_ACOSH, F_ATANH };
enum { G_MIN, G_MAX, G_ATAN2, G_MOD, G_HYPOT, G_ROOT, G_NCR, G_NPR, G_GCD, G_LOGB };

/* Códigos de error (los traduce JS a mensajes en español) */
enum { E_OK = 0, E_EMPTY = 1, E_CHAR = 2, E_NAME = 3, E_OPEN = 4, E_CLOSE = 5,
       E_COMPLEX = 6, E_FNPAREN = 7, E_ARGS = 8, E_END = 9, E_NUMBER = 10 };

/* Banderas de evaluación */
#define FL_DIV0   1
#define FL_DOMAIN 2
#define FL_OVER   4

typedef struct { u8 op; u8 id; double v; } Ins;
static Ins g_prog[SLOTS][MAX_INS];
static int g_plen[SLOTS];
static int g_plen_uses_x[SLOTS];
static int g_err, g_errpos, g_flags;
static int g_angle;            /* 0 = rad, 1 = deg, 2 = grad */
static double g_ans;

typedef struct { const char *s; int pos; Ins *code; int n; int sp, maxsp; int err, epos; int depth; int uses_x; int last_num; } PS;

typedef struct { const char *name; u8 kind; u8 id; } NameEnt;   /* kind: 0 const, 1 f(x), 2 f(x,y) */
static const NameEnt NAMES[] = {
    {"pi",0,0},{"tau",0,1},{"e",0,2},{"phi",0,3},{"inf",0,4},{"infinity",0,4},{"ans",0,5},{"x",0,6},
    {"sin",1,F_SIN},{"cos",1,F_COS},{"tan",1,F_TAN},{"asin",1,F_ASIN},{"acos",1,F_ACOS},{"atan",1,F_ATAN},
    {"arcsin",1,F_ASIN},{"arccos",1,F_ACOS},{"arctan",1,F_ATAN},
    {"sinh",1,F_SINH},{"cosh",1,F_COSH},{"tanh",1,F_TANH},{"asinh",1,F_ASINH},{"acosh",1,F_ACOSH},{"atanh",1,F_ATANH},
    {"sqrt",1,F_SQRT},{"cbrt",1,F_CBRT},{"ln",1,F_LN},{"log",1,F_LOG},{"log10",1,F_LOG},{"log2",1,F_LOG2},
    {"exp",1,F_EXP},{"abs",1,F_ABS},{"floor",1,F_FLOOR},{"ceil",1,F_CEIL},{"round",1,F_ROUND},
    {"sign",1,F_SIGN},{"sgn",1,F_SIGN},{"fact",1,F_FACT},
    {"min",2,G_MIN},{"max",2,G_MAX},{"atan2",2,G_ATAN2},{"mod",2,G_MOD},{"hypot",2,G_HYPOT},
    {"root",2,G_ROOT},{"ncr",2,G_NCR},{"npr",2,G_NPR},{"gcd",2,G_GCD},{"logb",2,G_LOGB},
};
#define NNAMES ((int)(sizeof(NAMES) / sizeof(NAMES[0])))

static void ps_fail(PS *p, int code, int pos) { if (!p->err) { p->err = code; p->epos = pos; } }
static void ps_emit(PS *p, int op, int id, double v, int dsp) {
    if (p->err) return;
    if (p->n >= MAX_INS) { ps_fail(p, E_COMPLEX, p->pos); return; }
    p->code[p->n].op = (u8)op; p->code[p->n].id = (u8)id; p->code[p->n].v = v; p->n++;
    p->sp += dsp;
    if (p->sp > p->maxsp) p->maxsp = p->sp;
    if (p->maxsp >= MAX_STACK) ps_fail(p, E_COMPLEX, p->pos);
}
static void ps_skip(PS *p) { while (p->s[p->pos] == ' ' || p->s[p->pos] == '\t' || p->s[p->pos] == '\r') p->pos++; }
static void parse_expr(PS *p);
static void parse_expr_inner(PS *p);

static void parse_number(PS *p) {
    int start = p->pos, i = p->pos, digits = 0;
    while (is_digit(p->s[i])) { i++; digits++; }
    if (p->s[i] == '.') { i++; while (is_digit(p->s[i])) { i++; digits++; } }
    if (!digits) { ps_fail(p, E_NUMBER, start); return; }
    if (lc(p->s[i]) == 'e') {                       /* exponente sólo si le siguen dígitos */
        int j = i + 1;
        if (p->s[j] == '+' || p->s[j] == '-') j++;
        if (is_digit(p->s[j])) { while (is_digit(p->s[j])) j++; i = j; }
    }
    if (i - start > 60) { ps_fail(p, E_NUMBER, start); return; }
    double v = h_num(p->s + start, i - start);
    if (is_nan(v)) { ps_fail(p, E_NUMBER, start); return; }
    p->pos = i;
    ps_emit(p, OP_NUM, 0, v, 1);
    p->last_num = 1;
}

static void parse_ident(PS *p) {
    int start = p->pos, best = -1, bestlen = 0, noparen = 0;
    for (int k = 0; k < NNAMES; k++) {
        const char *nm = NAMES[k].name; int l = 0;
        while (nm[l] && lc(p->s[start + l]) == nm[l]) l++;
        if (nm[l]) continue;                         /* no coincide completo */
        if (NAMES[k].kind != 0) {
            int j = start + l; while (p->s[j] == ' ') j++;
            if (p->s[j] != '(') { noparen = 1; continue; }
        }
        if (l > bestlen) { bestlen = l; best = k; }
    }
    if (best < 0) { ps_fail(p, noparen ? E_FNPAREN : E_NAME, start); return; }
    const NameEnt *ne = &NAMES[best];
    p->pos = start + bestlen;
    p->last_num = 0;
    if (ne->kind == 0) {
        switch (ne->id) {
            case 0: ps_emit(p, OP_NUM, 0, PI_D, 1); break;
            case 1: ps_emit(p, OP_NUM, 0, 2 * PI_D, 1); break;
            case 2: ps_emit(p, OP_NUM, 0, E_D, 1); break;
            case 3: ps_emit(p, OP_NUM, 0, PHI_D, 1); break;
            case 4: ps_emit(p, OP_NUM, 0, INF_D, 1); break;
            case 5: ps_emit(p, OP_NUM, 0, g_ans, 1); break;
            default: p->uses_x = 1; ps_emit(p, OP_X, 0, 0, 1); break;
        }
        return;
    }
    ps_skip(p); p->pos++;                            /* '(' */
    parse_expr(p); if (p->err) return;
    ps_skip(p);
    if (ne->kind == 1) {
        if (p->s[p->pos] == ',') { ps_fail(p, E_ARGS, p->pos); return; }
        if (p->s[p->pos] != ')') { ps_fail(p, p->s[p->pos] ? E_CLOSE : E_OPEN, p->pos); return; }
        p->pos++; p->last_num = 0;
        ps_emit(p, OP_F1, ne->id, 0, 0);
    } else {
        if (p->s[p->pos] != ',') { ps_fail(p, E_ARGS, p->pos); return; }
        p->pos++;
        parse_expr(p); if (p->err) return;
        ps_skip(p);
        if (p->s[p->pos] == ',') { ps_fail(p, E_ARGS, p->pos); return; }
        if (p->s[p->pos] != ')') { ps_fail(p, p->s[p->pos] ? E_CLOSE : E_OPEN, p->pos); return; }
        p->pos++; p->last_num = 0;
        ps_emit(p, OP_F2, ne->id, 0, -1);
    }
}

static void parse_primary(PS *p) {
    ps_skip(p);
    char c = p->s[p->pos];
    if (is_digit(c) || (c == '.' && is_digit(p->s[p->pos + 1]))) { parse_number(p); return; }
    if (c == '(') {
        p->pos++;
        parse_expr(p); if (p->err) return;
        ps_skip(p);
        if (p->s[p->pos] != ')') { ps_fail(p, E_OPEN, p->pos); return; }
        p->pos++; p->last_num = 0;
        return;
    }
    if (is_alpha(c)) { parse_ident(p); return; }
    if (c == 0)      { ps_fail(p, E_END, p->pos); return; }
    ps_fail(p, E_CHAR, p->pos);
}

static void parse_postfix(PS *p) {
    parse_primary(p);
    while (!p->err) {
        ps_skip(p);
        if (p->s[p->pos] == '!' && p->s[p->pos + 1] != '=') { p->pos++; p->last_num = 0; ps_emit(p, OP_FACT, 0, 0, 0); }
        else break;
    }
}

static void parse_unary(PS *p);
static void parse_power(PS *p) {
    parse_postfix(p);
    if (p->err) return;
    ps_skip(p);
    if (p->s[p->pos] == '^' || (p->s[p->pos] == '*' && p->s[p->pos + 1] == '*')) {
        p->pos += (p->s[p->pos] == '^') ? 1 : 2;
        if (++p->depth > MAX_DEPTH) { ps_fail(p, E_COMPLEX, p->pos); return; }
        parse_unary(p);                              /* asociatividad derecha: 2^3^2 = 2^9 */
        p->depth--;
        ps_emit(p, OP_POW, 0, 0, -1);
        p->last_num = 0;
    }
}

static void parse_unary(PS *p) {
    ps_skip(p);
    char c = p->s[p->pos];
    if (c == '-' || c == '+') {
        p->pos++;
        if (++p->depth > MAX_DEPTH) { ps_fail(p, E_COMPLEX, p->pos); return; }
        parse_unary(p);
        p->depth--;
        if (c == '-') ps_emit(p, OP_NEG, 0, 0, 0);
        p->last_num = 0;
        return;
    }
    parse_power(p);
}

static void parse_term(PS *p) {
    parse_unary(p);
    while (!p->err) {
        ps_skip(p);
        char c = p->s[p->pos];
        int op = -1;
        if (c == '*' && p->s[p->pos + 1] != '*') { op = OP_MUL; p->pos++; }
        else if (c == '/') { op = OP_DIV; p->pos++; }
        else if (c == '(' || is_alpha(c)) { op = OP_MUL; }
        else if (is_digit(c) || c == '.') {
            if (p->last_num) { ps_fail(p, E_CHAR, p->pos); return; }   /* "2 3" no es válido */
            op = OP_MUL;
        }
        if (op < 0) break;
        if (++p->depth > MAX_DEPTH) { ps_fail(p, E_COMPLEX, p->pos); return; }
        parse_unary(p);
        p->depth--;
        ps_emit(p, op, 0, 0, -1);
    }
}

static void parse_expr(PS *p) {
    if (++p->depth > MAX_DEPTH) { ps_fail(p, E_COMPLEX, p->pos); p->depth--; return; }
    parse_expr_inner(p);
    p->depth--;
}
static void parse_expr_inner(PS *p) {
    parse_term(p);
    while (!p->err) {
        ps_skip(p);
        char c = p->s[p->pos];
        if (c != '+' && c != '-') break;
        p->pos++;
        if (++p->depth > MAX_DEPTH) { ps_fail(p, E_COMPLEX, p->pos); return; }
        parse_term(p);
        p->depth--;
        ps_emit(p, c == '+' ? OP_ADD : OP_SUB, 0, 0, -1);
    }
}

/* Compila g_in en el slot indicado. Devuelve 0 o un código E_* (posición: oc_err_pos). */
EXPORT int oc_compile(int slot) {
    g_err = 0; g_errpos = 0;
    if (slot < 0 || slot >= SLOTS) { g_err = E_COMPLEX; return g_err; }
    const char *s = g_in;
    int i = 0; while (s[i] == ' ' || s[i] == '\t') i++;
    if (!s[i]) { g_err = E_EMPTY; g_errpos = 0; g_plen[slot] = 0; return g_err; }
    PS ps; ps.s = s; ps.pos = 0; ps.code = g_prog[slot]; ps.n = 0; ps.sp = 0; ps.maxsp = 0;
    ps.err = 0; ps.epos = 0; ps.depth = 0; ps.uses_x = 0; ps.last_num = 0;
    parse_expr(&ps);
    if (!ps.err) {
        ps_skip(&ps);
        if (s[ps.pos] == ')') ps_fail(&ps, E_CLOSE, ps.pos);
        else if (s[ps.pos]) ps_fail(&ps, E_CHAR, ps.pos);
    }
    if (ps.err) { g_err = ps.err; g_errpos = ps.epos; g_plen[slot] = 0; return g_err; }
    g_plen[slot] = ps.n; g_plen_uses_x[slot] = ps.uses_x;
    return 0;
}
EXPORT int oc_err_pos(void)       { return g_errpos; }
EXPORT int oc_uses_x(int slot)    { return (slot >= 0 && slot < SLOTS) ? g_plen_uses_x[slot] : 0; }
EXPORT void oc_set_angle(int m)   { g_angle = (m == 1 || m == 2) ? m : 0; }
EXPORT void oc_set_ans(double v)  { g_ans = v; }
EXPORT int  oc_flags(void)        { return g_flags; }

/* ----- funciones numéricas auxiliares ----- */
static double gamma_d(double z) {
    static const double c[9] = { 0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7 };
    if (z < 0.5) return PI_D / (m_sin(PI_D * z) * gamma_d(1.0 - z));
    z -= 1.0;
    double a = c[0], t = z + 7.5;
    for (int i = 1; i < 9; i++) a += c[i] / (z + i);
    return sqrt_d(2 * PI_D) * m_pow(t, z + 0.5) * m_exp(-t) * a;
}
static double fact_d(double x, int *fl) {
    if (is_nan(x)) return x;
    if (x == floor_d(x)) {
        if (x < 0) { *fl |= FL_DOMAIN; return NAN_D; }
        if (x > 170) { *fl |= FL_OVER; return INF_D; }
        double r = 1; for (int i = 2; i <= (int)x; i++) r *= i;
        return r;
    }
    if (x < -170.5) { *fl |= FL_DOMAIN; return NAN_D; }
    if (x > 170.5)  { *fl |= FL_OVER; return INF_D; }
    return gamma_d(x + 1.0);
}
static double to_deg(double x) {   /* convierte el ángulo del usuario a grados */
    return g_angle == 2 ? x * 0.9 : x;
}
static double trig(int id, double x) {
    if (g_angle == 0) {
        double r = id == F_SIN ? m_sin(x) : id == F_COS ? m_cos(x) : m_tan(x);
        if (fabs_d(r) < 1e-15 && fabs_d(x) > 1e-6) r = 0;       /* sin(pi) -> 0, cos(pi/2) -> 0 */
        return r;
    }
    double d = to_deg(x);
    if (!is_fin(d)) return NAN_D;
    double r = m_fmod(d, 360.0); if (r < 0) r += 360.0;
    if (id == F_SIN) { if (r == 0 || r == 180) return 0; if (r == 90) return 1; if (r == 270) return -1; return m_sin(d * (PI_D / 180)); }
    if (id == F_COS) { if (r == 90 || r == 270) return 0; if (r == 0) return 1; if (r == 180) return -1; return m_cos(d * (PI_D / 180)); }
    if (r == 90 || r == 270) return NAN_D;                      /* tan indefinida */
    if (r == 0 || r == 180) return 0;
    if (r == 45 || r == 225) return 1;
    if (r == 135 || r == 315) return -1;
    return m_tan(d * (PI_D / 180));
}
static double inv_trig(double r) { return g_angle == 1 ? r * (180 / PI_D) : g_angle == 2 ? r * (200 / PI_D) : r; }

static u64 gcd_u(u64 a, u64 b) { while (b) { u64 t = a % b; a = b; b = t; } return a; }

static double fn1(int id, double a, int *fl) {
    switch (id) {
        case F_SIN: case F_COS: case F_TAN: {
            if (!is_fin(a)) { if (!is_nan(a)) *fl |= FL_DOMAIN; return NAN_D; }
            double r = trig(id, a);
            if (is_nan(r) || fabs_d(r) > 1e15) { if (id == F_TAN) { *fl |= FL_DOMAIN; return NAN_D; } }
            return r;
        }
        case F_ASIN: if (a < -1 || a > 1) { *fl |= FL_DOMAIN; return NAN_D; } return inv_trig(m_asin(a));
        case F_ACOS: if (a < -1 || a > 1) { *fl |= FL_DOMAIN; return NAN_D; } return inv_trig(m_acos(a));
        case F_ATAN: return inv_trig(m_atan(a));
        case F_SINH: return m_sinh(a);
        case F_COSH: return m_cosh(a);
        case F_TANH: return m_tanh(a);
        case F_ASINH: return m_log(a + sqrt_d(a * a + 1));
        case F_ACOSH: if (a < 1) { *fl |= FL_DOMAIN; return NAN_D; } return m_log(a + sqrt_d(a * a - 1));
        case F_ATANH: if (a <= -1 || a >= 1) { *fl |= (a == 1 || a == -1) ? FL_DIV0 : FL_DOMAIN; return NAN_D; } return 0.5 * m_log((1 + a) / (1 - a));
        case F_SQRT: if (a < 0) { *fl |= FL_DOMAIN; return NAN_D; } return sqrt_d(a);
        case F_CBRT: return m_cbrt(a);
        case F_LN:   if (a < 0) { *fl |= FL_DOMAIN; return NAN_D; } if (a == 0) { *fl |= FL_DIV0; return NAN_D; } return m_log(a);
        case F_LOG:  if (a < 0) { *fl |= FL_DOMAIN; return NAN_D; } if (a == 0) { *fl |= FL_DIV0; return NAN_D; } return m_log10(a);
        case F_LOG2: if (a < 0) { *fl |= FL_DOMAIN; return NAN_D; } if (a == 0) { *fl |= FL_DIV0; return NAN_D; } return m_log2(a);
        case F_EXP:  return m_exp(a);
        case F_ABS:  return fabs_d(a);
        case F_FLOOR: return floor_d(a);
        case F_CEIL:  return ceil_d(a);
        case F_ROUND: return a < 0 ? -floor_d(-a + 0.5) : floor_d(a + 0.5);
        case F_SIGN:  return a > 0 ? 1 : a < 0 ? -1 : 0;
        case F_FACT:  return fact_d(a, fl);
    }
    return NAN_D;
}

static double fn2(int id, double a, double b, int *fl) {
    switch (id) {
        case G_MIN: return (is_nan(a) || is_nan(b)) ? NAN_D : (a < b ? a : b);
        case G_MAX: return (is_nan(a) || is_nan(b)) ? NAN_D : (a > b ? a : b);
        case G_ATAN2: return inv_trig(m_atan2(a, b));
        case G_MOD:   if (b == 0) { *fl |= FL_DIV0; return NAN_D; } return m_fmod(a, b);
        case G_HYPOT: return m_hypot(a, b);
        case G_ROOT:  /* raíz n-ésima de a */
            if (b == 0) { *fl |= FL_DIV0; return NAN_D; }
            if (a < 0) { if (b == floor_d(b) && m_fmod(b, 2) != 0) return -m_pow(-a, 1.0 / b); *fl |= FL_DOMAIN; return NAN_D; }
            return m_pow(a, 1.0 / b);
        case G_NCR: case G_NPR: {
            if (a != floor_d(a) || b != floor_d(b) || a < 0 || b < 0 || b > a) { *fl |= FL_DOMAIN; return NAN_D; }
            if (a > 1e6) { *fl |= FL_OVER; return INF_D; }
            double r = 1; double k = b;
            if (id == G_NCR && k > a - k) k = a - k;
            for (double i = 1; i <= k; i++) r = id == G_NCR ? r * (a - k + i) / i : r * (a - i + 1);
            return r;
        }
        case G_GCD: {
            if (a != floor_d(a) || b != floor_d(b) || fabs_d(a) > 9e15 || fabs_d(b) > 9e15) { *fl |= FL_DOMAIN; return NAN_D; }
            return (double)gcd_u((u64)fabs_d(a), (u64)fabs_d(b));
        }
        case G_LOGB:
            if (a < 0 || b <= 0 || b == 1) { *fl |= FL_DOMAIN; return NAN_D; }
            if (a == 0) { *fl |= FL_DIV0; return NAN_D; }
            return m_log(a) / m_log(b);
    }
    return NAN_D;
}

static double ev(const Ins *c, int n, double x, int *fl) {
    double st[MAX_STACK]; int sp = 0;
    for (int i = 0; i < n; i++) {
        switch (c[i].op) {
            case OP_NUM: st[sp++] = c[i].v; break;
            case OP_X:   st[sp++] = x; break;
            case OP_ADD: sp--; st[sp - 1] += st[sp]; break;
            case OP_SUB: sp--; st[sp - 1] -= st[sp]; break;
            case OP_MUL: sp--; st[sp - 1] *= st[sp]; break;
            case OP_DIV: sp--; if (st[sp] == 0) { *fl |= FL_DIV0; st[sp - 1] = NAN_D; } else st[sp - 1] /= st[sp]; break;
            case OP_POW: {
                sp--; double b = st[sp - 1], e = st[sp];
                if (e == 2) st[sp - 1] = b * b;
                else if (b == 0 && e < 0) { *fl |= FL_DIV0; st[sp - 1] = NAN_D; }
                else if (b < 0 && e != floor_d(e) && is_fin(e)) {
                    /* (-8)^(1/3) = -2 : exponente racional con denominador impar */
                    double inv = 1.0 / e, ri = floor_d(inv + 0.5);
                    if (fabs_d(inv - ri) < 1e-12 && m_fmod(ri, 2) != 0) st[sp - 1] = -m_pow(-b, e);
                    else { *fl |= FL_DOMAIN; st[sp - 1] = NAN_D; }
                } else st[sp - 1] = m_pow(b, e);
                break;
            }
            case OP_NEG:  st[sp - 1] = -st[sp - 1]; break;
            case OP_F1:   st[sp - 1] = fn1(c[i].id, st[sp - 1], fl); break;
            case OP_F2:   sp--; st[sp - 1] = fn2(c[i].id, st[sp - 1], st[sp], fl); break;
            case OP_FACT: st[sp - 1] = fact_d(st[sp - 1], fl); break;
        }
    }
    return st[0];
}

static double eval_slot(int slot, double x) {
    double r = ev(g_prog[slot], g_plen[slot], x, &g_flags);
    if (!is_fin(r) && !g_flags) g_flags |= is_nan(r) ? FL_DOMAIN : FL_OVER;
    return r;
}

EXPORT double oc_eval(int slot, double x) {
    g_flags = 0;
    if (slot < 0 || slot >= SLOTS || g_plen[slot] <= 0) { g_flags = FL_DOMAIN; return NAN_D; }
    return eval_slot(slot, x);
}

/* Evalúa n puntos x0, x0+dx, ... en g_pts (una sola llamada para toda la gráfica) */
EXPORT int oc_eval_range(int slot, double x0, double dx, int n) {
    g_flags = 0;
    if (n > PTS_CAP) n = PTS_CAP;
    if (slot < 0 || slot >= SLOTS || g_plen[slot] <= 0) { for (int i = 0; i < n; i++) g_pts[i] = NAN_D; return n; }
    const Ins *c = g_prog[slot]; int len = g_plen[slot];
    for (int i = 0; i < n; i++) { int fl = 0; g_pts[i] = ev(c, len, x0 + dx * i, &fl); }
    return n;
}

/* ===================================================================
 *  2. CÁLCULO NUMÉRICO
 * =================================================================== */
static int g_cslot, g_cmode, g_bad, g_evals;
static double g_cbase;

static double Fraw(double x) { g_evals++; int fl = 0; double v = ev(g_prog[g_cslot], g_plen[g_cslot], x, &fl); return v; }
static double Fm(double t) {
    if (g_cmode == 0) return Fraw(t);
    double u = 1.0 - t;
    if (u <= 0) return 0;
    double x = g_cmode == 1 ? g_cbase + t / u : g_cbase - t / u;
    return Fraw(x) / (u * u);
}
static double Fsafe(double t, double nudge_to) {      /* valor finito (o 0) para extremos singulares */
    double v = Fm(t);
    if (!is_fin(v)) { v = Fm(nudge_to); if (!is_fin(v)) { v = 0; g_bad++; } }
    return v;
}
static double asr(double a, double fa, double b, double fb, double m, double fm, double whole, double eps, int depth, double *err) {
    double lm = 0.5 * (a + m), rm = 0.5 * (m + b);
    double flm = Fm(lm), frm = Fm(rm);
    if (!is_fin(flm)) { flm = 0; g_bad++; }
    if (!is_fin(frm)) { frm = 0; g_bad++; }
    double left = (m - a) / 6.0 * (fa + 4 * flm + fm), right = (b - m) / 6.0 * (fm + 4 * frm + fb);
    double d = left + right - whole;
    if (depth <= 0 || fabs_d(d) <= 15 * eps || g_evals > 3000000) { *err += fabs_d(d) / 15; return left + right + d / 15; }
    return asr(a, fa, m, fm, lm, flm, left, 0.5 * eps, depth - 1, err) + asr(m, fm, b, fb, rm, frm, right, 0.5 * eps, depth - 1, err);
}
static double integrate_unit(double lo, double hi, double *err) {   /* integra Fm en [lo,hi] */
    enum { P = 32 };
    double h = (hi - lo) / P, fv[P + 1], rough = 0;
    double span = hi - lo, nud = span * 1e-10;
    for (int i = 0; i <= P; i++) {
        double t = lo + h * i;
        if (i == 0) fv[i] = Fsafe(t, t + nud);
        else if (i == P) fv[i] = Fsafe(t, t - nud);
        else { fv[i] = Fm(t); if (!is_fin(fv[i])) { fv[i] = 0; g_bad++; } }
        if (i > 0) rough += fabs_d(fv[i] + fv[i - 1]) * 0.5 * h;
    }
    double tol = 1e-11 * (rough > 1 ? rough : 1), total = 0;
    for (int i = 0; i < P; i++) {
        double a = lo + h * i, b = a + h, m = 0.5 * (a + b), fm = Fm(m);
        if (!is_fin(fm)) { fm = 0; g_bad++; }
        double whole = (b - a) / 6.0 * (fv[i] + 4 * fm + fv[i + 1]);
        total += asr(a, fv[i], b, fv[i + 1], m, fm, whole, tol / P, 22, err);
    }
    return total;
}

/* Integral definida; admite límites infinitos (inf / -inf). aux[0]=error estimado, aux[1]=puntos inválidos */
EXPORT double oc_integral(int slot, double a, double b) {
    g_aux[0] = 0; g_aux[1] = 0; g_aux[2] = 0;
    if (slot < 0 || slot >= SLOTS || g_plen[slot] <= 0 || is_nan(a) || is_nan(b)) return NAN_D;
    if (a == b) return 0;
    int sign = 1;
    if (a > b) { double t = a; a = b; b = t; sign = -1; }
    g_cslot = slot; g_bad = 0; g_evals = 0;
    double err = 0, res;
    if (is_fin(a) && is_fin(b)) { g_cmode = 0; res = integrate_unit(a, b, &err); }
    else if (is_fin(a) && b == INF_D) { g_cmode = 1; g_cbase = a; res = integrate_unit(0, 1, &err); }
    else if (a == -INF_D && is_fin(b)) { g_cmode = 2; g_cbase = b; res = integrate_unit(0, 1, &err); }
    else if (a == -INF_D && b == INF_D) {
        g_cmode = 1; g_cbase = 0; res = integrate_unit(0, 1, &err);
        g_cmode = 2; g_cbase = 0; res += integrate_unit(0, 1, &err);
    } else return NAN_D;
    g_aux[0] = err; g_aux[1] = g_bad; g_aux[2] = g_evals;
    return sign * res;
}

/* Derivada numérica 1ª/2ª con esquema de 5 puntos. aux[0]=error estimado, aux[1]=1 si posible punto no derivable */
EXPORT double oc_deriv(int slot, double x, int order) {
    g_aux[0] = 0; g_aux[1] = 0;
    if (slot < 0 || slot >= SLOTS || g_plen[slot] <= 0 || !is_fin(x)) return NAN_D;
    g_cslot = slot;
    double sc = fabs_d(x) > 1 ? fabs_d(x) : 1;
    double f0 = Fraw(x);
    if (!is_fin(f0)) return NAN_D;
    if (order == 2) {
        double h = 4e-3 * sc, f1 = Fraw(x + h), fm1 = Fraw(x - h), f2 = Fraw(x + 2 * h), fm2 = Fraw(x - 2 * h);
        double h2 = h * 0.5, g1 = Fraw(x + h2), gm1 = Fraw(x - h2), g2 = Fraw(x + 2 * h2), gm2 = Fraw(x - 2 * h2);
        double d1 = (-f2 + 16 * f1 - 30 * f0 + 16 * fm1 - fm2) / (12 * h * h);
        double d2 = (-g2 + 16 * g1 - 30 * f0 + 16 * gm1 - gm2) / (12 * h2 * h2);
        g_aux[0] = fabs_d(d1 - d2);
        return d2;
    }
    double h = 1e-3 * sc;
    double d1, d2;
    { double f1 = Fraw(x + h), fm1 = Fraw(x - h), f2 = Fraw(x + 2 * h), fm2 = Fraw(x - 2 * h);
      d1 = (-f2 + 8 * f1 - 8 * fm1 + fm2) / (12 * h); }
    { double hh = h * 0.5, f1 = Fraw(x + hh), fm1 = Fraw(x - hh), f2 = Fraw(x + 2 * hh), fm2 = Fraw(x - 2 * hh);
      d2 = (-f2 + 8 * f1 - 8 * fm1 + fm2) / (12 * hh); }
    g_aux[0] = fabs_d(d1 - d2);
    double e = 1e-7 * sc, r = (Fraw(x + e) - f0) / e, l = (f0 - Fraw(x - e)) / e;
    if (is_fin(r) && is_fin(l) && fabs_d(r - l) > 1e-3 * (1 + fabs_d(d2))) g_aux[1] = 1;
    if (!is_fin(d2)) return NAN_D;
    return d2;
}

/* Raíces de f(x)=0 en [a,b] por barrido + bisección. Devuelve cuántas (en g_pts). */
EXPORT int oc_roots(int slot, double a, double b, int maxr) {
    if (slot < 0 || slot >= SLOTS || g_plen[slot] <= 0 || !is_fin(a) || !is_fin(b) || a >= b) return 0;
    if (maxr > 128) maxr = 128;
    g_cslot = slot;
    enum { N = 4000 };
    double h = (b - a) / N, xp = a, fp = Fraw(a), scale = 0;
    int found = 0;
    for (int i = 0; i <= N; i++) { double x = a + h * i, f = Fraw(x); if (is_fin(f) && fabs_d(f) > scale) scale = fabs_d(f); }
    if (scale == 0) scale = 1;
    for (int i = 1; i <= N && found < maxr; i++) {
        double x = a + h * i, f = Fraw(x);
        if (is_fin(fp) && is_fin(f)) {
            if (fp == 0 && i == 1) { g_pts[found++] = xp; }
            if (f == 0) { if (found < maxr) g_pts[found++] = x; }
            else if (fp != 0 && ((fp < 0) != (f < 0))) {
                double lo = xp, hi = x, flo = fp;
                for (int k = 0; k < 200; k++) {
                    double mid = 0.5 * (lo + hi), fmid = Fraw(mid);
                    if (!is_fin(fmid)) break;
                    if (fmid == 0) { lo = hi = mid; break; }
                    if ((fmid < 0) == (flo < 0)) { lo = mid; flo = fmid; } else hi = mid;
                    if (hi - lo <= 1e-15 * (1 + fabs_d(mid))) break;
                }
                double r = 0.5 * (lo + hi), fr = Fraw(r);
                if (is_fin(fr) && fabs_d(fr) <= 1e-6 * scale) g_pts[found++] = r;   /* descarta polos (1/x, tan) */
            }
        }
        xp = x; fp = f;
    }
    return found;
}

/* ===================================================================
 *  3. ESTADÍSTICA
 * =================================================================== */
static void heapsort_d(double *a, int n) {
    for (int i = n / 2 - 1; i >= 0; i--) {
        int r = i;
        for (;;) { int c = 2 * r + 1; if (c >= n) break; if (c + 1 < n && a[c + 1] > a[c]) c++; if (a[r] >= a[c]) break; double t = a[r]; a[r] = a[c]; a[c] = t; r = c; }
    }
    for (int e = n - 1; e > 0; e--) {
        double t = a[0]; a[0] = a[e]; a[e] = t;
        int r = 0;
        for (;;) { int c = 2 * r + 1; if (c >= e) break; if (c + 1 < e && a[c + 1] > a[c]) c++; if (a[r] >= a[c]) break; double tt = a[r]; a[r] = a[c]; a[c] = tt; r = c; }
    }
}
static double quantile_sorted(const double *a, int n, double q) {
    double pos = (n - 1) * q; int lo = (int)floor_d(pos); double fr = pos - lo;
    return lo + 1 < n ? a[lo] + fr * (a[lo + 1] - a[lo]) : a[lo];
}

/* Estadística descriptiva sobre g_x[0..n). Resultados en aux[0..]; modos en oc_out (separados por '\n'). */
EXPORT int oc_stats(int n) {
    if (n < 1 || n > DATA_CAP) return 1;
    for (int i = 0; i < n; i++) if (!is_fin(g_x[i])) return 2;
    double mean = 0, m2 = 0, sum = 0, ssq = 0, logsum = 0, inv = 0; int pos = 1;
    for (int i = 0; i < n; i++) {                       /* Welford: estable numéricamente */
        double v = g_x[i], d = v - mean;
        sum += v; ssq += v * v;
        mean += d / (i + 1); m2 += d * (v - mean);
        g_work[i] = v;
        if (v > 0) { logsum += m_log(v); inv += 1.0 / v; } else pos = 0;
    }
    double m3 = 0, m4 = 0;
    for (int i = 0; i < n; i++) { double d = g_x[i] - mean; m3 += d * d * d; m4 += d * d * d * d; }
    heapsort_d(g_work, n);
    double varp = m2 / n, vars = n > 1 ? m2 / (n - 1) : NAN_D;
    g_aux[0] = n; g_aux[1] = sum; g_aux[2] = mean;
    g_aux[3] = quantile_sorted(g_work, n, 0.5);
    g_aux[4] = g_work[0]; g_aux[5] = g_work[n - 1]; g_aux[6] = g_work[n - 1] - g_work[0];
    g_aux[7] = quantile_sorted(g_work, n, 0.25); g_aux[8] = quantile_sorted(g_work, n, 0.75); g_aux[9] = g_aux[8] - g_aux[7];
    g_aux[10] = varp; g_aux[11] = vars; g_aux[12] = sqrt_d(varp); g_aux[13] = is_nan(vars) ? NAN_D : sqrt_d(vars);
    g_aux[14] = is_nan(g_aux[13]) ? NAN_D : g_aux[13] / sqrt_d((double)n);
    g_aux[15] = mean != 0 ? g_aux[13] / fabs_d(mean) : NAN_D;
    g_aux[18] = varp > 0 ? (m3 / n) / (varp * sqrt_d(varp)) : NAN_D;
    g_aux[19] = varp > 0 ? (m4 / n) / (varp * varp) - 3.0 : NAN_D;
    g_aux[20] = ssq;
    g_aux[21] = pos ? m_exp(logsum / n) : NAN_D;
    g_aux[22] = pos ? n / inv : NAN_D;
    /* moda(s) */
    int best = 1, run = 1;
    for (int i = 1; i <= n; i++) { if (i < n && g_work[i] == g_work[i - 1]) run++; else { if (run > best) best = run; run = 1; } }
    g_aux[16] = best; g_aux[17] = 0;
    o_reset();
    if (best > 1) {
        run = 1; int cnt = 0;
        for (int i = 1; i <= n; i++) {
            if (i < n && g_work[i] == g_work[i - 1]) run++;
            else { if (run == best) { if (cnt < 12) { if (cnt) o_nl(); o_num(g_work[i - 1]); } cnt++; } run = 1; }
        }
        g_aux[17] = cnt;
    }
    return 0;
}

/* Regresión lineal y = a + b x sobre (g_x, g_y)[0..n). */
EXPORT int oc_linreg(int n) {
    if (n < 2 || n > DATA_CAP) return 1;
    double sx = 0, sy = 0;
    for (int i = 0; i < n; i++) { if (!is_fin(g_x[i]) || !is_fin(g_y[i])) return 2; sx += g_x[i]; sy += g_y[i]; }
    double mx = sx / n, my = sy / n, sxx = 0, sxy = 0, syy = 0;
    for (int i = 0; i < n; i++) { double dx = g_x[i] - mx, dy = g_y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    if (sxx == 0) return 3;
    double b = sxy / sxx, a = my - b * mx;
    double r = syy > 0 ? sxy / sqrt_d(sxx * syy) : (double)1;
    g_aux[32] = b; g_aux[33] = a; g_aux[34] = r; g_aux[35] = r * r; g_aux[36] = n; g_aux[37] = mx; g_aux[38] = my;
    return 0;
}

/* ===================================================================
 *  4. ÁLGEBRA LINEAL  (matrices n x n, 2 <= n <= 5)
 *     A = oc_mat()[0..25), B = [25..50), resultado = [50..75)
 * =================================================================== */
static double *MA(void) { return g_mat[0]; }
static double *MB(void) { return g_mat[1]; }
static double *MR(void) { return g_mat[2]; }

static void o_mat(const double *M, int rows, int cols, int stride) {
    char cell[MAXN][2 * MAXN][40]; int w[2 * MAXN] = {0};
    for (int i = 0; i < rows; i++) for (int j = 0; j < cols; j++) {
        int len = h_fmt(M[i * stride + j], cell[i][j], 39); if (len < 0) len = 0; if (len > 39) len = 39;
        cell[i][j][len] = 0; if (len > w[j]) w[j] = len;
    }
    for (int i = 0; i < rows; i++) {
        o_s("[ ");
        for (int j = 0; j < cols; j++) { o_pad(cell[i][j], w[j]); o_s(j + 1 < cols ? "  " : " "); }
        o_s("]\n");
    }
}
static void o_int(int v) { o_i64(v); }

static void minor_of(const double *M, int n, int r, int c, double *out) {
    int k = 0;
    for (int i = 0; i < n; i++) { if (i == r) continue; for (int j = 0; j < n; j++) { if (j == c) continue; out[k++] = M[i * n + j]; } }
}
static double det_n(const double *M, int n) {       /* expansión de Laplace: exacta para enteros pequeños */
    if (n == 1) return M[0];
    if (n == 2) return M[0] * M[3] - M[1] * M[2];
    double s = 0, sub[(MAXN - 1) * (MAXN - 1)];
    for (int c = 0; c < n; c++) {
        if (M[c] == 0) continue;
        minor_of(M, n, 0, c, sub);
        double t = M[c] * det_n(sub, n - 1);
        s += (c & 1) ? -t : t;
    }
    return s;
}
static int is_singular(const double *M, int n, double det) {   /* tolerancia relativa (cota de Hadamard) */
    double bound = 1;
    for (int i = 0; i < n; i++) { double s = 0; for (int j = 0; j < n; j++) s += M[i * n + j] * M[i * n + j]; bound *= sqrt_d(s); }
    return bound == 0 || fabs_d(det) <= 1e-12 * bound;
}
static double norm1(const double *M, int n) {
    double best = 0;
    for (int j = 0; j < n; j++) { double s = 0; for (int i = 0; i < n; i++) s += fabs_d(M[i * n + j]); if (s > best) best = s; }
    return best;
}

/* Eliminación Gauss-Jordan con pivoteo parcial sobre M (rows x cols). Devuelve el rango. */
static int rref(double *M, int rows, int cols, int log, int pivcols) {
    double scale = 0;
    for (int i = 0; i < rows * cols; i++) if (fabs_d(M[i]) > scale) scale = fabs_d(M[i]);
    double tol = 1e-12 * (scale > 0 ? scale : 1);
    int r = 0;
    for (int c = 0; c < pivcols && r < rows; c++) {
        int p = r;
        for (int i = r + 1; i < rows; i++) if (fabs_d(M[i * cols + c]) > fabs_d(M[p * cols + c])) p = i;
        if (fabs_d(M[p * cols + c]) <= tol) { for (int i = r; i < rows; i++) M[i * cols + c] = 0; continue; }
        if (p != r) {
            for (int j = 0; j < cols; j++) { double t = M[r * cols + j]; M[r * cols + j] = M[p * cols + j]; M[p * cols + j] = t; }
            if (log) { o_s("F"); o_int(r + 1); o_s(" <-> F"); o_int(p + 1); o_nl(); }
        }
        double pv = M[r * cols + c];
        if (pv != 1) {
            for (int j = 0; j < cols; j++) M[r * cols + j] /= pv;
            if (log) { o_s("F"); o_int(r + 1); o_s(" <- F"); o_int(r + 1); o_s(" / "); o_num(pv); o_nl(); }
        }
        for (int i = 0; i < rows; i++) {
            if (i == r) continue;
            double f = M[i * cols + c];
            if (f == 0) continue;
            for (int j = 0; j < cols; j++) M[i * cols + j] -= f * M[r * cols + j];
            M[i * cols + c] = 0;
            if (log) { o_s("F"); o_int(i + 1); o_s(" <- F"); o_int(i + 1); o_s(" - ("); o_num(f); o_s(") F"); o_int(r + 1); o_nl(); }
        }
        if (log) o_mat(M, rows, cols, cols);
        r++;
    }
    return r;
}

static void mat_mul(const double *a, const double *b, double *r, int n) {
    double t[MAXN * MAXN];
    for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) { double s = 0; for (int k = 0; k < n; k++) s += a[i * n + k] * b[k * n + j]; t[i * n + j] = s; }
    for (int i = 0; i < n * n; i++) r[i] = t[i];
}
/* Inversa por cofactores/adjunta. Devuelve 0 ok, 1 singular. Si log, escribe los pasos. */
static int mat_inverse(const double *A, int n, double *R, int log) {
    double det = det_n(A, n);
    if (log) { o_s("PASO 1: Determinante\ndet(A) = "); o_num(det); o_nl(); o_nl(); }
    if (is_singular(A, n, det)) { if (log) o_s("det(A) = 0  ->  la matriz es singular, no tiene inversa.\n"); return 1; }
    double C[MAXN * MAXN], sub[(MAXN - 1) * (MAXN - 1)];
    if (n == 1) { R[0] = 1.0 / A[0]; return 0; }
    for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) {
        minor_of(A, n, i, j, sub);
        double d = det_n(sub, n - 1);
        C[i * n + j] = ((i + j) & 1) ? -d : d;
    }
    if (log) { o_s("PASO 2: Matriz de cofactores  C(i,j) = (-1)^(i+j) * M(i,j)\n"); o_mat(C, n, n, n); o_nl(); }
    double adj[MAXN * MAXN];
    for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) adj[i * n + j] = C[j * n + i];
    if (log) { o_s("PASO 3: Adjunta = transpuesta de los cofactores\n"); o_mat(adj, n, n, n); o_nl(); }
    for (int i = 0; i < n * n; i++) R[i] = adj[i] / det;
    if (log) { o_s("PASO 4: A^-1 = Adj(A) / det(A)\n"); }
    return 0;
}

/* op: 1 A+B, 2 A-B, 3 AxB, 4 A^T, 5 A^-1, 6 det, 7 rango, 8 traza, 9 A^k, 10 Ax=b (b = col 0 de B), 11 k*A, 12 A^T*A? (no)
 * Retorna: 0 = matriz en resultado, 1 = escalar en aux[0], 2 = singular, 3 = argumentos inválidos,
 *          4 = sistema incompatible, 5 = infinitas soluciones, 6 = no finito.  Pasos en oc_out. */
EXPORT int oc_matrix(int op, int n, double k) {
    o_reset(); g_aux[0] = 0; g_aux[1] = 0;
    if (n < 2 || n > MAXN) return 3;
    double *A = MA(), *B = MB(), *R = MR(); int nn = n * n;
    for (int i = 0; i < nn; i++) if (!is_fin(A[i]) || !is_fin(B[i])) return 6;
    for (int i = 0; i < nn; i++) R[i] = 0;
    switch (op) {
        case 1: for (int i = 0; i < nn; i++) R[i] = A[i] + B[i]; return 0;
        case 2: for (int i = 0; i < nn; i++) R[i] = A[i] - B[i]; return 0;
        case 3: mat_mul(A, B, R, n); return 0;
        case 4: for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) R[i * n + j] = A[j * n + i]; return 0;
        case 11: for (int i = 0; i < nn; i++) R[i] = A[i] * k; return 0;
        case 5: {
            int st = mat_inverse(A, n, R, 1);
            if (st) { for (int i = 0; i < nn; i++) R[i] = 0; return 2; }
            double cond = norm1(A, n) * norm1(R, n); g_aux[1] = cond;
            return 0;
        }
        case 6: {
            double det = det_n(A, n);
            if (is_singular(A, n, det)) det = 0;
            g_aux[0] = det;
            o_s("Desarrollo por cofactores (Laplace) sobre la primera fila:\n");
            if (n <= 3) {
                if (n == 2) { o_s("det = a*d - b*c = "); o_num(A[0]); o_s("*"); o_num(A[3]); o_s(" - "); o_num(A[1]); o_s("*"); o_num(A[2]); o_nl(); }
                else {
                    o_s("Regla de Sarrus: (aei + bfg + cdh) - (ceg + afh + bdi)\n");
                    o_s("det = ("); o_num(A[0]*A[4]*A[8]); o_s(" + "); o_num(A[1]*A[5]*A[6]); o_s(" + "); o_num(A[2]*A[3]*A[7]);
                    o_s(") - ("); o_num(A[2]*A[4]*A[6]); o_s(" + "); o_num(A[0]*A[5]*A[7]); o_s(" + "); o_num(A[1]*A[3]*A[8]); o_s(")\n");
                }
            } else {
                double sub[(MAXN - 1) * (MAXN - 1)];
                for (int c = 0; c < n; c++) {
                    minor_of(A, n, 0, c, sub);
                    o_s(c & 1 ? "  - " : (c ? "  + " : "    ")); o_num(A[c]); o_s(" * det(M1"); o_int(c + 1); o_s(") = "); o_num(A[c]); o_s(" * "); o_num(det_n(sub, n - 1)); o_nl();
                }
            }
            o_s("det(A) = "); o_num(det); o_nl();
            return 1;
        }
        case 7: {
            double T[MAXN * MAXN]; for (int i = 0; i < nn; i++) T[i] = A[i];
            o_s("Eliminación gaussiana (Gauss-Jordan):\n"); o_mat(T, n, n, n);
            int r = rref(T, n, n, 1, n);
            g_aux[0] = r; o_s("\nRango = número de filas pivote = "); o_int(r); o_nl();
            return 1;
        }
        case 8: { double t = 0; for (int i = 0; i < n; i++) t += A[i * n + i]; g_aux[0] = t; o_s("traza = suma de la diagonal principal"); return 1; }
        case 9: {
            int kk = (int)k; if (k != (double)kk || kk < -64 || kk > 64) return 3;
            double base[MAXN * MAXN], acc[MAXN * MAXN];
            if (kk < 0) { if (mat_inverse(A, n, base, 0)) return 2; kk = -kk; } else for (int i = 0; i < nn; i++) base[i] = A[i];
            for (int i = 0; i < nn; i++) acc[i] = (i % (n + 1) == 0) ? 1.0 : 0.0;
            while (kk > 0) { if (kk & 1) mat_mul(acc, base, acc, n); mat_mul(base, base, base, n); kk >>= 1; }
            for (int i = 0; i < nn; i++) R[i] = acc[i];
            return 0;
        }
        case 10: {
            double T[MAXN * (MAXN + 1)]; int cols = n + 1;
            for (int i = 0; i < n; i++) { for (int j = 0; j < n; j++) T[i * cols + j] = A[i * n + j]; T[i * cols + n] = B[i * n]; }
            o_s("Sistema Ax = b  (b = primera columna de B). Matriz aumentada [A|b]:\n"); o_mat(T, n, cols, cols);
            double T2[MAXN * (MAXN + 1)]; for (int i = 0; i < n * cols; i++) T2[i] = T[i];
            int rA = rref(T, n, cols, 1, n);
            /* rango de la ampliada */
            int rAug = rref(T2, n, cols, 0, cols);
            o_s("\nrango(A) = "); o_int(rA); o_s(",  rango([A|b]) = "); o_int(rAug); o_nl();
            if (rAug > rA) { o_s("El sistema es INCOMPATIBLE (sin solución).\n"); return 4; }
            if (rA < n)    { o_s("El sistema tiene INFINITAS soluciones (rango < n).\n"); return 5; }
            for (int i = 0; i < n; i++) R[i * n] = T[i * cols + n];
            o_s("Solución única: x = columna final de la forma escalonada reducida.\n");
            return 0;
        }
    }
    return 3;
}

/* ===================================================================
 *  5. PROGRAMADOR  (aritmética exacta de 64 bits, banderas de CPU)
 * =================================================================== */
/* Lee un entero de un campo: signo, prefijos 0x 0b 0o, '_' como separador. 0 ok, 1 inválido, 2 fuera de rango */
static int parse_u64(const char **pp, int base, u64 *mag, int *neg) {
    const char *p = *pp;
    while (*p == ' ' || *p == '\t') p++;
    *neg = 0;
    if (*p == '-') { *neg = 1; p++; } else if (*p == '+') p++;
    if (p[0] == '0' && (lc(p[1]) == 'x' || lc(p[1]) == 'b' || lc(p[1]) == 'o') && p[2] && !fend(p[2])) {
        base = lc(p[1]) == 'x' ? 16 : lc(p[1]) == 'b' ? 2 : 8; p += 2;
    }
    u64 v = 0; int nd = 0, over = 0;
    for (;; p++) {
        char c = *p; int d;
        if (c == '_') continue;
        if (is_digit(c)) d = c - '0'; else if (is_alpha(c)) d = lc(c) - 'a' + 10; else break;
        if (d >= base) return 1;
        if (v > (0xFFFFFFFFFFFFFFFFULL - (u64)d) / (u64)base) over = 1;
        v = v * (u64)base + (u64)d; nd++;
    }
    while (*p == ' ' || *p == '\t') p++;
    if (!nd || !fend(*p)) return 1;
    *pp = p; *mag = v;
    return over ? 2 : 0;
}

static void o_bin(u64 v, int w, int group) {
    for (int i = w - 1; i >= 0; i--) { o_ch((v >> i) & 1 ? '1' : '0'); if (group && i && (i % 4 == 0)) o_ch(' '); }
}
static void o_hex(u64 v) { char t[20]; int i = 0; if (!v) t[i++] = '0'; while (v) { t[i++] = "0123456789ABCDEF"[v & 15]; v >>= 4; } while (i) o_ch(t[--i]); }
static void o_oct(u64 v) { char t[24]; int i = 0; if (!v) t[i++] = '0'; while (v) { t[i++] = (char)('0' + (v & 7)); v >>= 3; } while (i) o_ch(t[--i]); }

/* Campos: A\nB.  ops: 1 AND 2 OR 3 XOR 4 SHL 5 SHR 6 NOT 7 NAND 8 NOR 9 ROL 10 ROR 11 ADD 12 SUB 13 MUL 14 DIV 15 MOD 16 SAR 17 NEG
 * Salida (oc_out): bin(agrupado) / oct / dec sin signo / dec con signo / hex / popcount / ceros líderes / ceros finales
 * aux: 0 CF, 1 OF, 2 ZF, 3 SF, 4 A truncado, 5 B truncado, 6 desplazamiento >= ancho
 * Retorna: 0 ok, 1 A inválido, 2 B inválido, 3 división entre cero, 4 ancho inválido, 5 A fuera de rango, 6 B fuera de rango */
EXPORT int oc_bits(int op, int w, int base) {
    for (int i = 0; i < 8; i++) g_aux[i] = 0;
    o_reset();
    if (w != 8 && w != 16 && w != 32 && w != 64) return 4;
    if (base != 2 && base != 8 && base != 10 && base != 16) base = 10;
    u64 mask = w == 64 ? ~0ULL : ((1ULL << w) - 1), sbit = 1ULL << (w - 1);
    u64 ma = 0, mb = 0; int na = 0, nb = 0;
    const char *pa = field(0), *pb = field(1);
    int ra = parse_u64(&pa, base, &ma, &na); if (ra) return ra == 2 ? 5 : 1;
    int rb = 0;
    { const char *q = pb; while (*q == ' ') q++;
      if (fend(*q)) { mb = 0; nb = 0; } else rb = parse_u64(&pb, base, &mb, &nb); }
    if (rb) return rb == 2 ? 6 : 2;
    /* complemento a dos y aviso de truncamiento */
    u64 a = na ? (0 - ma) : ma, b = nb ? (0 - mb) : mb;
    if ((!na && ma > mask) || (na && ma > sbit)) g_aux[4] = 1;
    if ((!nb && mb > mask) || (nb && mb > sbit)) g_aux[5] = 1;
    a &= mask; b &= mask;
    u64 r = 0; int cf = 0, of = 0;
    int sa = (a & sbit) != 0, sb = (b & sbit) != 0;
    switch (op) {
        case 1: r = a & b; break;
        case 2: r = a | b; break;
        case 3: r = a ^ b; break;
        case 4: if (b >= (u64)w) { r = 0; g_aux[6] = 1; } else r = (a << b) & mask; break;
        case 5: if (b >= (u64)w) { r = 0; g_aux[6] = 1; } else r = a >> b; break;
        case 16: {
            int sh = b >= (u64)w ? w : (int)b; if (b >= (u64)w) g_aux[6] = 1;
            r = sa ? (sh >= w ? mask : ((a >> sh) | (mask & ~(mask >> sh)))) : (sh >= w ? 0 : a >> sh);
            break;
        }
        case 6: r = ~a & mask; break;
        case 7: r = ~(a & b) & mask; break;
        case 8: r = ~(a | b) & mask; break;
        case 9:  { int s = (int)(b % (u64)w); r = s ? (((a << s) | (a >> (w - s))) & mask) : a; break; }
        case 10: { int s = (int)(b % (u64)w); r = s ? (((a >> s) | (a << (w - s))) & mask) : a; break; }
        case 11: r = (a + b) & mask; cf = w == 64 ? (r < a) : ((a + b) > mask); of = (sa == sb) && (((r & sbit) != 0) != sa); break;
        case 12: r = (a - b) & mask; cf = a < b; of = (sa != sb) && (((r & sbit) != 0) != sa); break;
        case 13: {
            r = (a * b) & mask;
            if (a && b > mask / a) cf = 1;
            u64 mga = sa ? ((0 - a) & mask) : a, mgb = sb ? ((0 - b) & mask) : b;   /* magnitudes con signo */
            u64 lim = (sa != sb) ? sbit : sbit - 1;
            if (mga && mgb > lim / mga) of = 1;
            break;
        }
        case 14: if (!b) return 3; r = a / b; break;
        case 15: if (!b) return 3; r = a % b; break;
        case 17: r = (0 - a) & mask; cf = a != 0; of = (a == sbit); break;
        default: return 4;
    }
    r &= mask;
    g_aux[0] = cf; g_aux[1] = of; g_aux[2] = r == 0; g_aux[3] = (r & sbit) != 0;
    o_bin(r, w, 1); o_nl();
    o_oct(r); o_nl();
    o_u64(r); o_nl();
    { i64 sv = (r & sbit) ? (i64)(r | ~mask) : (i64)r; o_i64(sv); } o_nl();
    o_hex(r); o_nl();
    { int pc = 0, lz = 0, tz = 0; u64 t = r; while (t) { pc += (int)(t & 1); t >>= 1; }
      for (int i = w - 1; i >= 0 && !((r >> i) & 1); i--) lz++;
      for (int i = 0; i < w && !((r >> i) & 1); i++) tz++;
      o_int(pc); o_nl(); o_int(lz); o_nl(); o_int(tz); }
    return 0;
}

/* Representación IEEE-754. Salida: signo / exponente(bits) / mantisa(bits) / hex / exp. sin sesgo / clase / valor almacenado */
EXPORT int oc_ieee(double v, int f32) {
    o_reset();
    u64 bits, man; int ebits, mbits, sign, ex, bias;
    double stored = v;
    if (f32) {
        float f = (float)v; u32 b; __builtin_memcpy(&b, &f, 4); bits = b; ebits = 8; mbits = 23; bias = 127; stored = (double)f;
    } else { __builtin_memcpy(&bits, &v, 8); ebits = 11; mbits = 52; bias = 1023; }
    sign = (int)((bits >> (ebits + mbits)) & 1);
    ex = (int)((bits >> mbits) & ((1ULL << ebits) - 1));
    man = bits & ((1ULL << mbits) - 1);
    o_ch(sign ? '1' : '0'); o_nl();
    o_bin((u64)ex, ebits, 0); o_nl();
    o_bin(man, mbits, 0); o_nl();
    o_hex(bits); o_nl();
    o_int(ex == 0 ? (man ? 1 - bias : 0) : ex - bias); o_nl();
    int maxe = (1 << ebits) - 1;
    o_s(ex == maxe ? (man ? "NaN" : (sign ? "-Infinito" : "+Infinito")) : ex == 0 ? (man ? "Subnormal" : "Cero") : "Normal"); o_nl();
    o_num(stored);
    return 0;
}

/* ===================================================================
 *  6. MATEMÁTICAS DISCRETAS  (enteros grandes exactos, teoría de números, lógica)
 * =================================================================== */
#define BN_LIMBS 1100            /* base 1e9 => hasta 9900 dígitos */
typedef struct { u32 d[BN_LIMBS]; int n; } BN;
static BN g_bn, g_bn2;

static void bn_set(BN *a, u32 v) { a->d[0] = v % 1000000000u; a->n = 1; if (v >= 1000000000u) { a->d[1] = v / 1000000000u; a->n = 2; } }
static int bn_mul(BN *a, u32 m) {
    u64 carry = 0;
    for (int i = 0; i < a->n; i++) { u64 t = (u64)a->d[i] * m + carry; a->d[i] = (u32)(t % 1000000000u); carry = t / 1000000000u; }
    while (carry) { if (a->n >= BN_LIMBS) return 0; a->d[a->n++] = (u32)(carry % 1000000000u); carry /= 1000000000u; }
    return 1;
}
static u32 bn_div(BN *a, u32 m) {
    u64 rem = 0;
    for (int i = a->n - 1; i >= 0; i--) { u64 cur = a->d[i] + rem * 1000000000u; a->d[i] = (u32)(cur / m); rem = cur % m; }
    while (a->n > 1 && a->d[a->n - 1] == 0) a->n--;
    return (u32)rem;
}
static int bn_add(BN *a, const BN *b) {
    u32 carry = 0; int n = a->n > b->n ? a->n : b->n;
    for (int i = 0; i < n; i++) {
        u32 x = (i < a->n ? a->d[i] : 0) + (i < b->n ? b->d[i] : 0) + carry;
        if (x >= 1000000000u) { x -= 1000000000u; carry = 1; } else carry = 0;
        a->d[i] = x;
    }
    a->n = n;
    if (carry) { if (n >= BN_LIMBS) return 0; a->d[a->n++] = 1; }
    return 1;
}
static int bn_digits(const BN *a) { int d = (a->n - 1) * 9; u32 t = a->d[a->n - 1]; do { d++; t /= 10; } while (t); return d; }
static void o_bn(const BN *a) {
    char t[12]; u32 v = a->d[a->n - 1]; int i = 0;
    do { t[i++] = (char)('0' + v % 10); v /= 10; } while (v);
    while (i) o_ch(t[--i]);
    for (int k = a->n - 2; k >= 0; k--) { v = a->d[k]; for (int j = 8; j >= 0; j--) { u32 p = 1; for (int q = 0; q < j; q++) p *= 10; o_ch((char)('0' + (v / p) % 10)); } }
}

/* ops: 1 nPr, 2 nCr, 3 n!, 4 Fibonacci(n), 5 n^r (perm. con repetición), 6 C(n+r-1,r) (comb. con repetición), 7 Catalan(n)
 * Retorna 0 ok, 1 argumentos inválidos, 2 resultado demasiado grande. aux[0] = nº de dígitos. */
EXPORT int oc_discrete(int op, double nd, double rd) {
    o_reset(); g_aux[0] = 0;
    if (!is_fin(nd) || !is_fin(rd) || nd != floor_d(nd) || rd != floor_d(rd) || nd < 0 || rd < 0 || nd > 4e9 || rd > 4e9) return 1;
    u32 n = (u32)nd, r = (u32)rd;
    BN *a = &g_bn; bn_set(a, 1);
    switch (op) {
        case 1: if (r > n) return 1; for (u32 i = 0; i < r; i++) if (!bn_mul(a, n - i)) return 2; break;
        case 2: {
            if (r > n) return 1; u32 k = r > n - r ? n - r : r;
            for (u32 i = 1; i <= k; i++) { if (!bn_mul(a, n - k + i)) return 2; bn_div(a, i); }
            break;
        }
        case 3: if (n > 3000) return 2; for (u32 i = 2; i <= n; i++) if (!bn_mul(a, i)) return 2; break;
        case 4: {
            if (n > 40000) return 2;
            BN *x = &g_bn, *y = &g_bn2; bn_set(x, 0); bn_set(y, 1);
            for (u32 i = 0; i < n; i++) { if (!bn_add(x, y)) return 2; BN *t = x; x = y; y = t; }
            a = x;
            break;
        }
        case 5: if (n > 0 || r == 0) { for (u32 i = 0; i < r; i++) if (!bn_mul(a, n)) return 2; } else bn_set(a, 0); break;
        case 6: {
            if (n == 0 && r > 0) { bn_set(a, 0); break; }
            if (n == 0) break;
            u64 top = (u64)n + r - 1; if (top > 4000000000ULL) return 1;
            u32 k = r > (u32)(top - r) ? (u32)(top - r) : r;
            for (u32 i = 1; i <= k; i++) { if (!bn_mul(a, (u32)(top - k + i))) return 2; bn_div(a, i); }
            break;
        }
        case 7: {
            if (n > 4000) return 2;
            u32 k = n;
            for (u32 i = 1; i <= k; i++) { if (!bn_mul(a, n + i)) return 2; bn_div(a, i); }
            bn_div(a, n + 1);
            break;
        }
        default: return 1;
    }
    g_aux[0] = bn_digits(a);
    o_bn(a);
    return 0;
}

/* ----- Teoría de números (u64) ----- */
static u64 mulmod(u64 a, u64 b, u64 m) {
    u64 r = 0; a %= m;
    while (b) { if (b & 1) r = (r >= m - a) ? r - (m - a) : r + a; a = (a >= m - a) ? a - (m - a) : a + a; b >>= 1; }
    return r;
}
static u64 powmod(u64 a, u64 e, u64 m) {
    u64 r = 1 % m; a %= m;
    while (e) { if (e & 1) r = mulmod(r, a, m); a = mulmod(a, a, m); e >>= 1; }
    return r;
}
static int is_prime_u64(u64 n) {
    if (n < 2) return 0;
    static const u64 sp[12] = {2,3,5,7,11,13,17,19,23,29,31,37};
    for (int i = 0; i < 12; i++) { if (n == sp[i]) return 1; if (n % sp[i] == 0) return 0; }
    u64 d = n - 1; int s = 0; while (!(d & 1)) { d >>= 1; s++; }
    for (int i = 0; i < 12; i++) {
        u64 x = powmod(sp[i], d, n);
        if (x == 1 || x == n - 1) continue;
        int comp = 1;
        for (int r = 1; r < s; r++) { x = mulmod(x, x, n); if (x == n - 1) { comp = 0; break; } }
        if (comp) return 0;
    }
    return 1;
}
static u64 rho(u64 n) {
    if (!(n & 1)) return 2;
    for (u64 c = 1; c < 100; c++) {
        u64 x = 2, y = 2, d = 1;
        while (d == 1) {
            x = mulmod(x, x, n) + c; if (x >= n || x < c) x -= n;
            y = mulmod(y, y, n) + c; if (y >= n || y < c) y -= n;
            y = mulmod(y, y, n) + c; if (y >= n || y < c) y -= n;
            d = gcd_u(x > y ? x - y : y - x, n);
        }
        if (d != n) return d;
    }
    return n;
}
static int g_nf; static u64 g_fac[72];
static void factor_rec(u64 n) {
    if (n == 1) return;
    if (is_prime_u64(n)) { if (g_nf < 72) g_fac[g_nf++] = n; return; }
    u64 d = rho(n);
    if (d == n) { if (g_nf < 72) g_fac[g_nf++] = n; return; }
    factor_rec(d); factor_rec(n / d);
}
static i64 egcd(i64 a, i64 b, i64 *x, i64 *y) {
    i64 x0 = 1, y0 = 0, x1 = 0, y1 = 1;
    while (b) { i64 q = a / b, t = a - q * b; a = b; b = t; t = x0 - q * x1; x0 = x1; x1 = t; t = y0 - q * y1; y0 = y1; y1 = t; }
    *x = x0; *y = y0; return a;
}

/* op 1: gcd, lcm, Bezout (a,b)   -> líneas: gcd / lcm / x / y
 * op 2: primalidad y factorización (a) -> líneas: estado / factorización / nº divisores / φ(n)
 * op 3: a^b mod m   -> línea: resultado
 * op 4: inverso modular a^-1 mod m  -> línea: resultado
 * Retorna 0 ok, 1 entrada inválida, 2 fuera de rango, 3 sin inverso, 4 módulo 0, 5 overflow en mcm */
EXPORT int oc_numtheory(int op) {
    o_reset();
    u64 v[3] = {0, 0, 0}; int need = op == 3 ? 3 : (op == 2 ? 1 : 2);
    for (int i = 0; i < need; i++) {
        const char *p = field(i); int neg; int r = parse_u64(&p, 10, &v[i], &neg);
        if (r || neg) return r == 2 ? 2 : 1;
    }
    switch (op) {
        case 1: {
            if (v[0] > (1ULL << 62) || v[1] > (1ULL << 62)) return 2;
            i64 x, y; i64 g = egcd((i64)v[0], (i64)v[1], &x, &y);
            u64 gu = (u64)g;
            o_u64(gu); o_nl();
            if (gu == 0) o_s("0"); else { u64 q = v[0] / gu; if (v[1] && q > 0xFFFFFFFFFFFFFFFFULL / v[1]) return 5; o_u64(q * v[1]); }
            o_nl(); o_i64(x); o_nl(); o_i64(y);
            return 0;
        }
        case 2: {
            u64 n = v[0];
            if (n < 2) { o_s(n == 1 ? "unidad" : "cero"); o_nl(); o_s(n == 1 ? "1" : "0"); o_nl(); o_s("1"); o_nl(); o_s("1"); return 0; }
            g_nf = 0; u64 m = n;
            for (u64 p = 2; p < 1000 && p * p <= m; p += (p == 2 ? 1 : 2)) while (m % p == 0) { g_fac[g_nf++] = p; m /= p; }
            if (m > 1) factor_rec(m);
            /* ordenar factores (burbuja: <= 64) */
            for (int i = 0; i < g_nf; i++) for (int j = i + 1; j < g_nf; j++) if (g_fac[j] < g_fac[i]) { u64 t = g_fac[i]; g_fac[i] = g_fac[j]; g_fac[j] = t; }
            int prime = (g_nf == 1);
            o_s(prime ? "primo" : "compuesto"); o_nl();
            u64 tau = 1, phi = n;
            for (int i = 0; i < g_nf;) {
                int j = i; while (j < g_nf && g_fac[j] == g_fac[i]) j++;
                int e = j - i;
                if (i) o_s(" x ");
                o_u64(g_fac[i]); if (e > 1) { o_ch('^'); o_int(e); }
                tau *= (u64)(e + 1); phi = phi / g_fac[i] * (g_fac[i] - 1);
                i = j;
            }
            o_nl(); o_u64(tau); o_nl(); o_u64(phi);
            return 0;
        }
        case 3: if (!v[2]) return 4; o_u64(powmod(v[0], v[1], v[2])); return 0;
        case 4: {
            if (!v[1]) return 4;
            if (v[0] > (1ULL << 62) || v[1] > (1ULL << 62)) return 2;
            i64 x, y; i64 g = egcd((i64)(v[0] % v[1]), (i64)v[1], &x, &y);
            if (g != 1) return 3;
            i64 m = (i64)v[1]; x %= m; if (x < 0) x += m;
            o_i64(x); return 0;
        }
    }
    return 1;
}

/* ----- Lógica proposicional: tabla de verdad ----- */
typedef struct { const char *s; int pos; int err; int epos; unsigned row; int var[26]; int nvars; int depth; } LP;
static void lp_skip(LP *p) { while (p->s[p->pos] == ' ' || p->s[p->pos] == '\t') p->pos++; }
static void lp_fail(LP *p, int c) { if (!p->err) { p->err = c; p->epos = p->pos; } }
static int lp_iff(LP *p, int eval);
static int lp_atom(LP *p, int eval) {
    lp_skip(p); char c = p->s[p->pos];
    if (p->err) return 0;
    if (c == '!' || c == '~') {
        if (++p->depth > 40) { lp_fail(p, E_COMPLEX); return 0; }
        p->pos++; int v = !lp_atom(p, eval); p->depth--; return v;
    }
    if (c == '(') {
        if (++p->depth > 40) { lp_fail(p, E_COMPLEX); return 0; }
        p->pos++; int v = lp_iff(p, eval); lp_skip(p);
        p->depth--;
        if (p->s[p->pos] != ')') { lp_fail(p, E_OPEN); return 0; }
        p->pos++; return v;
    }
    if (c == '0' || c == '1') { p->pos++; return c == '1'; }
    if (is_alpha(c) && !is_alpha(p->s[p->pos + 1])) {
        int k = lc(c) - 'a'; p->pos++;
        if (eval) { return (int)((p->row >> p->var[k]) & 1); }
        if (p->var[k] < 0) p->var[k] = -2;      /* marca "usada" */
        return 0;
    }
    if (c == 0) lp_fail(p, E_END); else lp_fail(p, E_CHAR);
    return 0;
}
static int lp_and(LP *p, int eval) {
    int v = lp_atom(p, eval);
    for (;;) { lp_skip(p); if (p->s[p->pos] == '&') { p->pos++; int r = lp_atom(p, eval); v = v & r; } else break; }
    return v;
}
static int lp_xor(LP *p, int eval) {
    int v = lp_and(p, eval);
    for (;;) { lp_skip(p); if (p->s[p->pos] == '^') { p->pos++; int r = lp_and(p, eval); v = v ^ r; } else break; }
    return v;
}
static int lp_or(LP *p, int eval) {
    int v = lp_xor(p, eval);
    for (;;) { lp_skip(p); if (p->s[p->pos] == '|') { p->pos++; int r = lp_xor(p, eval); v = v | r; } else break; }
    return v;
}
static int lp_imp(LP *p, int eval) {
    int v = lp_or(p, eval);
    lp_skip(p);
    if (p->s[p->pos] == '-' && p->s[p->pos + 1] == '>') { p->pos += 2; int r = lp_imp(p, eval); return (!v) | r; }
    return v;
}
static int lp_iff(LP *p, int eval) {
    int v = lp_imp(p, eval);
    for (;;) {
        lp_skip(p);
        if (p->s[p->pos] == '<' && p->s[p->pos + 1] == '-' && p->s[p->pos + 2] == '>') { p->pos += 3; int r = lp_imp(p, eval); v = (v == r); } else break;
    }
    return v;
}
/* Salida: línea 0 = variables ("p q r"); luego una línea por fila "bits|resultado". aux: 0 nvars, 1 filas, 2 nº de verdaderos
 * Retorna 0 ok, o un código E_* (oc_err_pos da la posición); 6 = demasiadas variables. */
EXPORT int oc_truth(void) {
    o_reset(); g_err = 0; g_errpos = 0;
    LP p; p.s = g_in; p.pos = 0; p.err = 0; p.epos = 0; p.row = 0; p.nvars = 0; p.depth = 0;
    for (int i = 0; i < 26; i++) p.var[i] = -1;
    lp_iff(&p, 0); lp_skip(&p);
    if (!p.err && p.s[p.pos]) lp_fail(&p, p.s[p.pos] == ')' ? E_CLOSE : E_CHAR);
    if (p.err) { g_err = p.err; g_errpos = p.epos; return p.err; }
    int nv = 0, order[26];
    for (int i = 0; i < 26; i++) if (p.var[i] == -2) order[nv++] = i;
    if (nv > 6) return E_COMPLEX;
    for (int i = 0; i < 26; i++) p.var[i] = 0;
    for (int i = 0; i < nv; i++) p.var[order[i]] = nv - 1 - i;           /* la primera variable = bit más alto */
    for (int i = 0; i < nv; i++) { if (i) o_ch(' '); o_ch((char)('a' + order[i])); }
    unsigned rows = 1u << nv; int trues = 0;
    for (unsigned r = 0; r < rows; r++) {
        p.row = r; p.pos = 0;
        int v = lp_iff(&p, 1);
        o_nl();
        for (int i = nv - 1; i >= 0; i--) o_ch(((r >> i) & 1) ? '1' : '0');
        o_ch('|'); o_ch(v ? '1' : '0');
        trues += v;
    }
    g_aux[0] = nv; g_aux[1] = rows; g_aux[2] = trues;
    return 0;
}

/* ===================================================================
 *  7. REDES IPv4
 * =================================================================== */
static const char *p_ipv4(const char *s, u32 *out) {
    u32 v = 0;
    for (int i = 0; i < 4; i++) {
        if (!is_digit(*s)) return 0;
        u32 o = 0; int nd = 0;
        while (is_digit(*s)) { o = o * 10 + (u32)(*s - '0'); s++; if (++nd > 3) return 0; }
        if (o > 255) return 0;
        v = (v << 8) | o;
        if (i < 3) { if (*s != '.') return 0; s++; }
    }
    *out = v; return s;
}
static void o_ip(u32 v) { o_u64((v >> 24) & 255); o_ch('.'); o_u64((v >> 16) & 255); o_ch('.'); o_u64((v >> 8) & 255); o_ch('.'); o_u64(v & 255); }
static void o_ipbin(u32 v) { for (int i = 3; i >= 0; i--) { o_bin((v >> (8 * i)) & 255, 8, 0); if (i) o_ch('.'); } }
static int cidr_of_mask(u32 m) { int c = 0; while (m & 0x80000000u) { c++; m <<= 1; } return m ? -1 : c; }
static u32 mask_of(int c) { return c == 0 ? 0 : (0xFFFFFFFFu << (32 - c)); }

/* Lee ip[/cidr] (campo 0) y máscara (campo 1: punteada, /n o n). Devuelve prefijo 0..32 o código negativo:
 * -1 IP inválida, -2 máscara inválida, -3 máscara no contigua, -4 falta máscara */
static int net_parse(u32 *ip) {
    const char *f0 = field(0);
    while (*f0 == ' ' || *f0 == '\t') f0++;
    const char *p = p_ipv4(f0, ip);
    if (!p) return -1;
    while (*p == ' ') p++;
    int prefix = -4;
    if (*p == '/') {
        p++; while (*p == ' ') p++;
        int c = 0, nd = 0; while (is_digit(*p)) { c = c * 10 + (*p - '0'); p++; if (++nd > 2) return -2; }
        if (!nd || c > 32) return -2; prefix = c;
        while (*p == ' ') p++;
    }
    if (!fend(*p)) return -1;
    const char *m = field(1); while (*m == ' ') m++;
    if (!fend(*m)) {
        int c = -2;
        if (*m == '/' || is_digit(*m)) {
            const char *q = *m == '/' ? m + 1 : m; int v = 0, nd = 0; const char *t = q;
            while (is_digit(*t)) { v = v * 10 + (*t - '0'); t++; if (++nd > 2) { v = 99; break; } }
            if (nd && v <= 32 && (fend(*t) || *t == ' ')) c = v;
            else {  /* ¿máscara punteada? */
                u32 mm; const char *e = p_ipv4(q, &mm); if (e) { c = cidr_of_mask(mm); if (c < 0) return -3; }
            }
        }
        if (c < 0) return -2;
        prefix = c;
    }
    return prefix;
}

static const char *ip_type(u32 ip) {
    u32 a = ip >> 24, b = (ip >> 16) & 255, c = (ip >> 8) & 255;
    if (ip == 0xFFFFFFFFu) return "Broadcast limitado";
    if (a == 0) return "Reservada (esta red)";
    if (a == 10) return "Privada (RFC 1918)";
    if (a == 100 && (b & 0xC0) == 64) return "CGNAT (100.64.0.0/10)";
    if (a == 127) return "Loopback";
    if (a == 169 && b == 254) return "APIPA / enlace local";
    if (a == 172 && b >= 16 && b <= 31) return "Privada (RFC 1918)";
    if (a == 192 && b == 0 && c == 0) return "Protocolo IETF";
    if (a == 192 && b == 0 && c == 2) return "Documentación (TEST-NET-1)";
    if (a == 192 && b == 168) return "Privada (RFC 1918)";
    if (a == 198 && (b == 18 || b == 19)) return "Pruebas de rendimiento";
    if (a == 198 && b == 51 && c == 100) return "Documentación (TEST-NET-2)";
    if (a == 203 && b == 0 && c == 113) return "Documentación (TEST-NET-3)";
    if (a >= 224 && a <= 239) return "Multicast";
    if (a >= 240) return "Reservada (experimental)";
    return "Pública";
}
static const char *ip_class(u32 ip) {
    u32 a = ip >> 24;
    return a < 128 ? "A" : a < 192 ? "B" : a < 224 ? "C" : a < 240 ? "D (multicast)" : "E (experimental)";
}

/* Campos: ip[/cidr] \n máscara.  Líneas de salida:
 * red / broadcast / primer host / último host / nº hosts / wildcard / máscara / prefijo / clase / tipo /
 * IP binaria / máscara binaria / red binaria / IP entera / IP hex / DNS inverso
 * Retorna 0 o -(código) de net_parse (1..4). */
EXPORT int oc_net(void) {
    o_reset(); u32 ip = 0; int pf = net_parse(&ip);
    if (pf < 0) return -pf;
    u32 mask = mask_of(pf), net = ip & mask, bc = net | ~mask, first, last; u64 hosts;
    if (pf == 32) { first = last = ip; hosts = 1; }
    else if (pf == 31) { first = net; last = bc; hosts = 2; }
    else { first = net + 1; last = bc - 1; hosts = (u64)bc - net - 1; }
    o_ip(net); o_nl(); o_ip(bc); o_nl(); o_ip(first); o_nl(); o_ip(last); o_nl(); o_u64(hosts); o_nl();
    o_ip(~mask); o_nl(); o_ip(mask); o_nl(); o_ch('/'); o_int(pf); o_nl();
    o_s(ip_class(ip)); o_nl(); o_s(ip_type(ip)); o_nl();
    o_ipbin(ip); o_nl(); o_ipbin(mask); o_nl(); o_ipbin(net); o_nl();
    o_u64(ip); o_nl(); o_s("0x"); o_hex(ip); o_nl();
    o_u64(ip & 255); o_ch('.'); o_u64((ip >> 8) & 255); o_ch('.'); o_u64((ip >> 16) & 255); o_ch('.'); o_u64(ip >> 24); o_s(".in-addr.arpa");
    g_aux[0] = pf; g_aux[1] = (double)hosts; g_aux[2] = (double)ip; g_aux[3] = (double)net;
    return 0;
}

/* Divide la red (campos como oc_net) en subredes de prefijo newp. Lista [start, start+count).
 * Líneas: "idx|red/prefijo|primer|último|broadcast". aux[0] = nº total de subredes.
 * Retorna 0 ok, 1..4 error de red, 5 prefijo nuevo inválido (debe ser mayor al actual y <= 32). */
EXPORT int oc_subnets(int newp, double start, int count) {
    o_reset(); u32 ip = 0; int pf = net_parse(&ip);
    if (pf < 0) return -pf;
    if (newp <= pf || newp > 32) return 5;
    u32 net = ip & mask_of(pf); u64 total = 1ULL << (newp - pf), size = 1ULL << (32 - newp);
    g_aux[0] = (double)total;
    if (count > 256) count = 256;
    u64 s = start > 0 ? (u64)start : 0;
    for (u64 i = s; i < total && (int)(i - s) < count; i++) {
        u32 sn = net + (u32)(i * size), eb = sn + (u32)(size - 1);
        u32 f = newp >= 31 ? sn : sn + 1, l = newp >= 31 ? eb : eb - 1;
        if (i > s) o_nl();
        o_u64(i + 1); o_ch('|'); o_ip(sn); o_ch('/'); o_int(newp); o_ch('|'); o_ip(f); o_ch('|'); o_ip(l); o_ch('|'); o_ip(eb);
    }
    return 0;
}
/* Menor prefijo que aloja h hosts utilizables (VLSM). -1 si no cabe. */
EXPORT int oc_prefix_for_hosts(double h) {
    if (!(h >= 1) || h > 4294967294.0) return -1;
    u64 need = (u64)h + 2;
    int bits = 0; while (((u64)1 << bits) < need) bits++;
    return 32 - bits;
}
