import math


def S_func(cu, p_ler=0.001849):
    """Soil factor S based on clay content (Ligning 7: S = exp(-p_ler * lerprocent))."""
    return math.exp(-p_ler * cu)

HUMUS_BY_JB = {
    1: 3.0,
    2: 3.0,
    3: 2.4,
    4: 3.7,
    5: 3.0,
    6: 2.2,
    7: 1.7,
    8: 1.7,
    9: 1.7,
    10: 1.7,
    11: 10.0,
    12: 1.7,
}

CN_BY_JB = {
    1: 14.2,
    2: 12.8,
    3: 13.3,
    4: 11.6,
    5: 12.8,
    6: 11.0,
    7: 10.4,
    8: 10.4,
    9: 10.4,
    10: 10.4,
    11: 20.0,
    12: 10.4,
}

BD_BY_JB = {
    1: 1.45,
    2: 1.42,
    3: 1.44,
    4: 1.41,
    5: 1.51,
    6: 1.53,
    7: 1.54,
    8: 1.60,
    9: 1.60,
    10: 1.60,
    11: 0.97,
    12: 1.60,
}


def calculate_nt_from_jb(jb_nr: int) -> float:
    """Calculate NT from JB number using humus, CN and bulk density."""
    humus = HUMUS_BY_JB.get(jb_nr)
    cn = CN_BY_JB.get(jb_nr)
    bd = BD_BY_JB.get(jb_nr)
    if humus is None or cn is None or bd is None:
        raise ValueError(f"Unknown JB number for NT calculation: {jb_nr}")

    jordmasse_ton_ha = bd * 0.25 * 10000
    c_ton_ha = jordmasse_ton_ha * (humus / 100) * 0.58
    nt = c_ton_ha / cn
    return round(nt, 3)


def P_func(jbnr, AAa, AAb, APb,
        delta1s=0.001194,
        delta2s=0.001107,
        noo2s=0.000856,
        delta1c=0.000798,
        delta2c=0.000745,
        noo2c=0.000638):
    """Perkolation factor P based on soil group and seasonal percolation.

    Parameters:
    - AAa: April–August perkolation (mm)
    - AAb: September–March perkolation in the leaching year (mm)
    - APb: September–March perkolation in the preceding year (mm)
    """
    if jbnr <= 3:
        return (1 - math.exp(-delta1s * AAa - delta2s * AAb)) * math.exp(-noo2s * APb)
    return (1 - math.exp(-delta1c * AAa - delta2c * AAb)) * math.exp(-noo2c * APb)


def C_func(M, W, MP, WP):
    """Crop effect C based on crop group codes (Bilag 2, tabel 3/5/8).

    § 23, stk. 4-bekendtgørelsens faste 2027-parameterværdi (7,2595 for
    vinterplantedække til forfrugt, uanset hvad forfrugten faktisk var) er bevidst
    IKKE implementeret her — reglen er uafklaret og forventes ændret, så WP
    kategoriopslås som for alle andre år (jf. WP_p nedenfor).
    """
    M_p = {
        1: 0,
        2: -6.744,
        3: -7.279,
        4: -13.493,
        5: -17.478,
        6: -11.192,
        7: -0.640,
        8: 3.534,
        9: -7.319,
        10: -1.248,
        11: 19.524,
        12: -6.229,
        13: -2.866,
    }
    W_p = {
        1: 0,
        2: -2.055,
        3: -0.456,
        4: -15.959,
        5: -3.792,
        6: -14.596,
        7: -1.049,
        8: -21.060,
    }
    MP_p = {
        1: 0,
        2: 2.847,
        3: 0.664,
        4: 1.166,
    }
    WP_p = {
        1: 0,
        2: 9.704,
        3: 10.601,
        4: 9.354,
        5: 13.241,
        6: 5.483,
        7: -1.572,
        8: 7.413,
        9: 7.396,
        10: 10.975,
    }

    return (
        M_p.get(M, 0)
        + W_p.get(W, 0)
        + MP_p.get(MP, 0)
        + WP_p.get(WP, 0)
    )


def N_func(NT,
           MNCS,
           MNCA,
           MNudb,
           M1,
           M2,
           F0,
           F1,
           F2,
           G0,
           G1,
           G2,
           WC,
           beta_t=0.456793,
           beta_CS=0.04957,
           beta_CA=0.157044,
           beta_udb=0.016314,
           beta_m1_M=0.026499,
           beta_f0=0.038245,
           beta_f1=0.025499,
           beta_g0=0.014099,
           beta_m1_G=0.026499,
           theta_2=1.205144):
    """Nitrogen effect Ntheta based on mineral, fixation, organic, and historical N.

    Beta-værdier jf. Bilag 2, tabel 9.
    """
    N = (
        beta_t * NT
        + beta_CS * MNCS
        + beta_CA * MNCA
        + beta_udb * MNudb
        + beta_m1_M * ((M1 + M2) / 2)
        + beta_f0 * F0
        + beta_f1 * ((F1 + F2) / 2)
        + beta_g0 * G0
        + beta_m1_G * ((G1 + G2) / 2)
    )
    return N if WC == 1 else N * theta_2


# Bilag 8 tabulerer kun den daglige §38-dagsbasis-kurve fra 9/8 til og med 7/9
# (fristen i §33 stk. 1 nr. 2). Datoer efter 7/9 har intet officielt kildebelæg
# og er bevidst UDELADT her — Fdato_factor() falder tilbage til 1.0 (ingen
# EEA-effekt-justering) for datoer uden for tabellen. UI'et (streamlit_app.py,
# FDATO_OPTIONS) begrænser tilsvarende sådato-vælgeren til dette interval.
FDATO_EFFECT_BY_DATE = {
    "9/8": 1.16,
    "10/8": 1.15,
    "11/8": 1.13,
    "12/8": 1.12,
    "13/8": 1.10,
    "14/8": 1.09,
    "15/8": 1.07,
    "16/8": 1.06,
    "17/8": 1.04,
    "18/8": 1.03,
    "19/8": 1.01,
    "20/8": 1.00,
    "21/8": 0.99,
    "22/8": 0.97,
    "23/8": 0.96,
    "24/8": 0.94,
    "25/8": 0.93,
    "26/8": 0.91,
    "27/8": 0.90,
    "28/8": 0.88,
    "29/8": 0.87,
    "30/8": 0.85,
    "31/8": 0.84,
    "1/9": 0.83,
    "2/9": 0.81,
    "3/9": 0.80,
    "4/9": 0.78,
    "5/9": 0.77,
    "6/9": 0.75,
    "7/9": 0.74,
}


def Fdato_factor(value):
    """Return numeric Fdato factor from a date string or numeric value."""
    if isinstance(value, str):
        normalized = value.strip().replace(' ', '')
        if normalized in FDATO_EFFECT_BY_DATE:
            return FDATO_EFFECT_BY_DATE[normalized]
        try:
            day, month = normalized.split('/')
            key = f"{int(day)}/{int(month)}"
            return FDATO_EFFECT_BY_DATE.get(key, 1)
        except Exception:
            return 1
    try:
        return float(value)
    except (TypeError, ValueError):
        return 1


# §37: standard (ikke-præcision) EEA-effekt — trappefunktion 45/42/40/33%,
# gyldig til og med de datointervaller lovbekendtgørelsen angiver.
# Efter 7/9 (fristen i §33 stk. 1 nr. 2) er der ingen effekt uden præcisionsteknologi.
FDATO_STEP_RATES = [
    ((8, 20), 45),
    ((8, 24), 42),
    ((8, 28), 40),
    ((9, 7), 33),
]


def fdato_step_factor(value):
    """Standard EEA-effekt jf. §37 (trappefunktion), som andel af fuld sats (45%).

    Bruges når efterafgrøden IKKE er etableret med præcisionsteknologi (§38).
    Ved præcisionsteknologi bruges i stedet den daglige Bilag 8-kurve, `Fdato_factor`.
    """
    if isinstance(value, str):
        normalized = value.strip().replace(' ', '')
        try:
            day, month = normalized.split('/')
            day, month = int(day), int(month)
        except Exception:
            return 1.0
    else:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 1.0

    md = (month, day)
    for (m_max, d_max), pct in FDATO_STEP_RATES:
        if md <= (m_max, d_max):
            return pct / 45.0
    return 0.0


_MAIZE_M_CODES = {8, 11}


def reference_w_for_eea(M, crop_name=""):
    """Reference-efterårsplantedække (W) for NUAR EEA-beregning (Tabel 1.3).

    Majshelsæd (M=8/11) og kartofler bruger W3 (bar jord efter majshelsæd/kartofler).
    Frøgræs (M=5) er ekskluderet fra standardreferencen — returnerer None (brug brugerens W).
    Alle andre afgrøder bruger W5 (spildkorn og ukrudt).
    """
    if M in _MAIZE_M_CODES or "kartofl" in (crop_name or "").lower():
        return 3
    if M == 5:
        return None
    return 5


def resolve_ema(sample):
    """Resolve EMA from a mellemafgrøde choice or explicit EMA value."""
    if sample.get("mellemafgroede", False):
        return 0.20
    return sample.get("EMA", 0)


def resolve_ets(sample):
    """Resolve ETS based on early sowing selection and afterafgrøde exclusion."""
    if sample.get("mellemafgroede", False):
        return 0
    if sample.get("early_sowing", False):
        return 0.20
    return sample.get("ETS", 0)


def nuar_adjustment(L,
                     EEA=0,
                     Fdato=1,
                     EMA=0,
                     ETS=0,
                     EPJ=0.04):
    """Apply NUAR virkemidler adjustment to base NLES5 leaching."""
    fdato_factor = Fdato_factor(Fdato)
    return L * (1 - EEA * fdato_factor - EMA - ETS) * (1 - EPJ)


def nles5(Y,
          Ntheta,
          C,
          P,
          S,
          EEA=0,
          Fdato=1,
          EMA=0,
          ETS=0,
          EPJ=0.04,
          tau=-0.1108,
          mu=23.51,
          kappa=1.5,
          rho=1.085):
    """Calculate nitrogen leaching L using NLES5 formula and NUAR adjustment.
    
    Formula: L = tau * (Y - 1991) + (base_term ** kappa) * ((P * S) ** rho)
    where base_term = mu + Ntheta + C
    """
    base_term = mu + Ntheta + C
    
    # Validate that base_term is positive (as required by NLES5)
    if base_term <= 0:
        raise ValueError(
            f"NLES5 base term must be positive. "
            f"Got mu + Ntheta + C = {base_term} "
            f"(mu={mu}, Ntheta={Ntheta}, C={C})"
        )
    
    # NLES5 formula: L = tau * (Y - 1991) + (base_term ** kappa) * ((P * S) ** rho)
    # Clamp to 0: negative values are physically impossible (model extrapolation artefact)
    L = max(0.0, tau * (Y - 1991) + (base_term ** kappa) * ((P * S) ** rho))

    L_nuar = nuar_adjustment(L, EEA, Fdato, EMA, ETS, EPJ)
    return {
        "L": L,
        "L_nuar": L_nuar,
        "Ntheta": Ntheta,
        "C": C,
        "P": P,
        "S": S,
        "EEA": EEA,
        "Fdato": Fdato,
        "EMA": EMA,
        "ETS": ETS,
        "EPJ": EPJ,
    }


_KARTOFFEL_KODER = frozenset({149, 150, 151, 152, 154, 155, 156})

# M11-korrektion: korrektionsfaktor til nitratudvaskning i majs (forfrugt græs/kløvergræs)
# som funktion af tilført mineralsk N om foråret (MNCS, kg N/ha). Trin på 10 kg N/ha.
_MAJS_M11_KORREKTION = {
    0: 0.56, 10: 0.59, 20: 0.61, 30: 0.64, 40: 0.67, 50: 0.69, 60: 0.72,
    70: 0.76, 80: 0.78, 90: 0.82, 100: 0.86, 110: 0.91, 120: 0.94,
    130: 0.98, 140: 1.02, 150: 1.05, 160: 1.09, 170: 1.13, 180: 1.16,
    190: 1.19, 200: 1.23,
}
_MAJS_M11_MNCS_POINTS = sorted(_MAJS_M11_KORREKTION)


def majs_m11_korrektionsfaktor(mncs):
    """Korrektionsfaktor for M=11 (majshelsæd, forfrugt græs/kløvergræs) baseret på MNCS.

    Bilag 2, tabel 1 definerer diskrete 10 kg N/ha-intervaller (0-9, 10-19, ...,
    190-199, 200), hver med sin egen faste faktor — IKKE et sæt punkter til
    interpolation. MNCS over 200 klampes til slutværdien for 200.
    """
    mncs = max(0.0, float(mncs))
    pts = _MAJS_M11_MNCS_POINTS
    if mncs >= pts[-1]:
        return _MAJS_M11_KORREKTION[pts[-1]]
    bucket = (int(mncs) // 10) * 10
    return _MAJS_M11_KORREKTION[bucket]


def calculate_leaching(sample):
    """Calculate leaching from a sample dictionary of inputs."""
    # Kartoffelregel: M=2 for disse koder uanset brugervalg (NUAR AU-anbefaling 2027)
    if sample.get("crop_code") in _KARTOFFEL_KODER:
        sample = {**sample, "M": 2}

    nt_source = sample.get("NT_source", "manual")
    if sample.get("NT_source") == "jb_calc":
        nt_value = calculate_nt_from_jb(sample.get("jbnr", 1))
    else:
        nt_value = sample.get("NT", 0)

    # §24 stk. 7-9: kvælstoffiksering fra efterafgrødeblanding med kvælstoffikserende
    # arter (kløver, lucerne, vikke m.fl., jf. §40 nr. 2) giver en flad bonus på 35 kg N.
    # Bonussen skal foldes ind i F0 AF KALDEREN (så den er synlig og videreføres til
    # F1/F2 i efterfølgende år) — her bruges den kun til at annotere resultatet, IKKE
    # til at justere F0 igen (undgår dobbelt-tælling).
    efa_nfiks_bonus = 35.0 if sample.get("efterafgroede_nfiks", False) else 0.0

    ntheta = N_func(
        NT=nt_value,
        MNCS=sample.get("MNCS", 0),
        MNCA=sample.get("MNCA", 0),
        MNudb=sample.get("MNudb", 0),
        M1=sample.get("M1", 0),
        M2=sample.get("M2", 0),
        F0=sample.get("F0", 0),
        F1=sample.get("F1", 0),
        F2=sample.get("F2", 0),
        G0=sample.get("G0", 0),
        G1=sample.get("G1", 0),
        G2=sample.get("G2", 0),
        WC=sample.get("WC", 1),
    )
    ema = resolve_ema(sample)
    eea = 0 if sample.get("mellemafgroede", False) else sample.get("EEA", 0)

    w_original = sample.get("W", 1)
    w_ref = (
        reference_w_for_eea(sample.get("M", 1), sample.get("crop_name", ""))
        if eea > 0
        else None
    )
    w_used = w_ref if (w_ref is not None and eea > 0) else w_original

    c = C_func(
        M=sample.get("M", 1),
        W=w_used,
        MP=sample.get("MP", 1),
        WP=sample.get("WP", 1),
    )
    if sample.get("P_override") is not None:
        p = float(sample["P_override"])
    else:
        p = P_func(
            jbnr=sample.get("jbnr", 1),
            AAa=sample.get("AAa", 0),
            AAb=sample.get("AAb", 0),
            APb=sample.get("APb", 0),
        )
    if sample.get("S_override") is not None:
        s = float(sample["S_override"])
    else:
        s = S_func(sample.get("CU", 0))
    fdato_input = sample.get("Fdato", 1)
    # §38: kun ved dokumenteret præcisionsteknologi bruges den daglige Bilag 8-kurve.
    # Standard (§37) er en trappefunktion med fire faste satser.
    if sample.get("precision_dagsbasis", False):
        fdato = Fdato_factor(fdato_input)
    else:
        fdato = fdato_step_factor(fdato_input)

    ets = resolve_ets(sample)

    result = nles5(
        Y=sample.get("Y", 2024),
        Ntheta=ntheta,
        C=c,
        P=p,
        S=s,
        EEA=eea,
        Fdato=fdato,
        EMA=ema,
        ETS=ets,
        EPJ=sample.get("EPJ", 0.04),
    )
    # M11-korrektion: majshelsæd (forfrugt græs/kløvergræs) — korriger udvaskning ud fra MNCS
    m11_anvendt = sample.get("M") == 11
    m11_mncs = sample.get("MNCS", 0)
    m11_faktor = majs_m11_korrektionsfaktor(m11_mncs) if m11_anvendt else None
    if m11_anvendt:
        result["L"] *= m11_faktor
        result["L_nuar"] *= m11_faktor

    result.update({
        "mellemafgroede": sample.get("mellemafgroede", False),
        "EMA": ema,
        "ETS": ets,
        "Fdato": fdato_input,
        "Fdato_factor": fdato,
        "precision_dagsbasis": sample.get("precision_dagsbasis", False),
        "efterafgroede_nfiks": sample.get("efterafgroede_nfiks", False),
        "efterafgroede_nfiks_bonus": efa_nfiks_bonus,
        "leaching_kgN_ha": round(result["L"], 3),
        "L_nuar_kgN_ha": round(result["L_nuar"], 3),
        "NT": nt_value,
        "NT_source": nt_source,
        "NT_from_jb": sample.get("NT_source") == "jb_calc",
        "W_original": w_original,
        "W_ref": w_ref,
        "W_used": w_used,
        "M11_korrektion_anvendt": m11_anvendt,
        "M11_korrektionsfaktor": m11_faktor,
        "M11_MNCS": m11_mncs if m11_anvendt else None,
    })
    return result


def sample_crop_mapping():
    return {
        "Y": 2024,
        "NT": 0.5,
        "MNCS": 20,
        "MNCA": 15,
        "MNudb": 0,
        "M1": 5,
        "M2": 5,
        "F0": 0,
        "F1": 0,
        "F2": 0,
        "G0": 0,
        "G1": 0,
        "G2": 0,
        "WC": 1,
        "M": 1,
        "W": 1,
        "MP": 1,
        "WP": 1,
        "jbnr": 4,
        "AAa": 100,
        "AAb": 100,
        "APb": 100,
        "CU": 20,
        "EEA": 0,
        "Fdato": 1,
        "EMA": 0,
        "ETS": 0,
        "EPJ": 0.04,
        "mellemafgroede": False,
        "early_sowing": False,
        "irrigated": False,
    }
