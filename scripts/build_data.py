from __future__ import annotations

import json
import shutil
import unicodedata
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

LETTERS = list("abcdefghijklmnopqrstuvwxyz")
VOWELS = set("aeiou")
MANUAL_ENTRIES = [
    {"source": "amanhã", "compressed": "amn", "kind": "manual-word", "reason": "atalho popular com queda de vogais internas"},
    {"source": "você", "compressed": "vc", "kind": "manual-word", "reason": "abreviação consolidada em chats"},
    {"source": "vocês", "compressed": "vcs", "kind": "manual-word", "reason": "plural consolidado em chats"},
    {"source": "também", "compressed": "tbm", "kind": "manual-word", "reason": "abreviação popular preservando consoantes"},
    {"source": "porque", "compressed": "pq", "kind": "manual-word", "reason": "atalho frequente em mensagens"},
    {"source": "que", "compressed": "q", "kind": "manual-word", "reason": "atalho curtíssimo muito comum em chat, mesmo sobrepondo o verbete literal raro"},
    {"source": "beleza", "compressed": "blz", "kind": "manual-word", "reason": "forma popular de internet"},
    {"source": "falou", "compressed": "flw", "kind": "manual-word", "reason": "forma popular preservando ritmo sonoro"},
    {"source": "galera", "compressed": "glr", "kind": "manual-word", "reason": "atalho de uso corrente"},
    {"source": "mensagem", "compressed": "msg", "kind": "manual-word", "reason": "abreviação já naturalizada em apps"},
    {"source": "mesmo", "compressed": "msm", "kind": "manual-word", "reason": "supressão de vogais com leitura estável"},
    {"source": "obrigado", "compressed": "obgd", "kind": "manual-word", "reason": "abreviação popular sem colidir com 'obrigada'"},
    {"source": "obrigada", "compressed": "obgda", "kind": "manual-word", "reason": "variante feminina mantida sem ambiguidade"},
    {"source": "qualquer", "compressed": "qlqr", "kind": "manual-word", "reason": "compressão manual muito usada em chats"},
    {"source": "valeu", "compressed": "vlw", "kind": "manual-word", "reason": "forma popular de encerramento"},
    {"source": "por favor", "compressed": "pfvr", "kind": "manual-phrase", "reason": "expressão fixa com leitura imediata"},
    {"source": "por causa", "compressed": "pcsa", "kind": "manual-phrase", "reason": "expressão frequente preservando consoantes fortes"},
    {"source": "de boa", "compressed": "dboa", "kind": "manual-phrase", "reason": "expressão coloquial preservada"},
    {"source": "tudo bem", "compressed": "tdbm", "kind": "manual-phrase", "reason": "expressão frequente com queda de vogais"},
    {"source": "sem problemas", "compressed": "smpblms", "kind": "manual-phrase", "reason": "expressão fixa com esqueleto consonantal"},
]


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return value.lower()


def normalize_word(value: str) -> str:
    return "".join(char for char in normalize_text(value) if "a" <= char <= "z")


def load_source_words(data_dir: Path) -> list[str]:
    words: set[str] = set()
    for chunk_path in sorted((data_dir / "chunks").glob("*.json")):
        chunk = json.loads(chunk_path.read_text(encoding="utf-8"))
        for source, *_rest in chunk["entries"]:
            if normalize_word(source):
                words.add(source)
    return sorted(words, key=lambda word: normalize_text(word))


def load_manual_entries(_data_dir: Path) -> list[dict]:
    return [entry.copy() for entry in MANUAL_ENTRIES]


def sort_variants(variants: list[str]) -> list[str]:
    return sorted(
        variants,
        key=lambda value: (
            count_accents(value),
            len(value),
            normalize_text(value),
            value,
        ),
    )


def count_accents(value: str) -> int:
    return sum(1 for char in value if normalize_text(char) != char.lower())


def build_edge_priority(normalized_word: str) -> tuple[list[str], list[int]]:
    letters = list(normalized_word)
    if len(letters) <= 2:
        return letters, list(range(len(letters)))

    order = [0]
    used = {0}
    left = 1
    right = len(letters) - 1

    while left <= right:
        if right not in used:
            order.append(right)
            used.add(right)
        if left not in used:
            order.append(left)
            used.add(left)
        left += 1
        right -= 1

    consonants = [index for index in order[1:] if letters[index] not in VOWELS and letters[index] != "h"]
    vowels = [index for index in order[1:] if letters[index] in VOWELS]
    h_letters = [index for index in order[1:] if letters[index] == "h"]
    ranked = [0, *consonants, *vowels, *h_letters]
    return letters, ranked


def abbreviate(letters: list[str], ranked: list[int], level: int) -> str:
    chosen = sorted(ranked[:level])
    return "".join(letters[index] for index in chosen)


def build_candidate_sequence(normalized_word: str) -> list[dict]:
    letters, ranked = build_edge_priority(normalized_word)
    if len(letters) <= 2:
        return [{"text": normalized_word, "kind": "original"}]

    candidates: list[dict] = []
    seen: set[str] = set()

    for length in range(2, len(letters) + 1):
        if length == len(letters):
            candidate = normalized_word
            if candidate not in seen:
                seen.add(candidate)
                candidates.append({"text": candidate, "kind": "original"})
            continue

        if length >= 3:
            prefix_candidate = normalized_word[:length]
            if prefix_candidate not in seen:
                seen.add(prefix_candidate)
                candidates.append({"text": prefix_candidate, "kind": "direct"})

        edge_candidate = abbreviate(letters, ranked, length)
        if edge_candidate not in seen:
            seen.add(edge_candidate)
            candidates.append({"text": edge_candidate, "kind": "direct"})

    return candidates


def choose_collision_winner(peers: list[dict]) -> dict:
    return sorted(
        peers,
        key=lambda item: (
            len(item["candidates"]) - item["index"],
            len(item["normalized"]),
            count_accents(item["preferredSource"]),
            item["preferredSource"],
        ),
    )[0]


def finalize_group(item: dict, candidate_meta: dict | None) -> list[dict]:
    entries: list[dict] = []
    candidate_text = candidate_meta["text"] if candidate_meta else item["normalized"]
    candidate_kind = candidate_meta["kind"] if candidate_meta else "original"
    shortened = candidate_kind != "original" and len(candidate_text) < len(item["normalized"])

    if shortened:
        strategy = "auto-collision" if item["hadConflict"] else "auto-edge"
        reason = (
            "usa a forma curta direta mais agressiva disponivel"
            if strategy == "auto-edge"
            else "vence a colisao com uma forma curta e empurra as outras para candidatos maiores"
        )
    else:
        strategy = "kept-original"
        reason = "compressao nao gerou ganho real"

    for source in item["variants"]:
        entries.append(
            {
                "source": source,
                "normalized": item["normalized"],
                "compressed": candidate_text if shortened else item["normalized"],
                "displayCompressed": candidate_text if shortened else source,
                "kind": "auto" if shortened else "original",
                "reason": reason,
                "strategy": strategy,
                "resolutionLevel": item["index"] + 1 if candidate_meta else len(item["candidates"]),
            }
        )

    return entries


def build_entries(words: list[str], manual_entries: list[dict]) -> tuple[list[dict], list[dict]]:
    manual_words = {normalize_word(entry["source"]): entry for entry in manual_entries if entry["kind"] == "manual-word"}
    manual_phrases = [entry for entry in manual_entries if entry["kind"] == "manual-phrase"]
    reserved = {normalize_word(entry["compressed"]) for entry in manual_entries}
    grouped_words: dict[str, list[str]] = defaultdict(list)

    for word in words:
        grouped_words[normalize_word(word)].append(word)

    canonical_sources = set(grouped_words)
    entries: list[dict] = []
    active: list[dict] = []

    for normalized, variants in grouped_words.items():
        variants = sort_variants(variants)
        if normalized in manual_words:
            rule = manual_words[normalized]
            for source in variants:
                entries.append(
                    {
                        "source": source,
                        "normalized": normalized,
                        "compressed": normalize_word(rule["compressed"]),
                        "displayCompressed": rule["compressed"],
                        "kind": rule["kind"],
                        "reason": rule["reason"],
                        "strategy": "manual",
                    }
                )
            continue

        active.append(
            {
                "normalized": normalized,
                "variants": variants,
                "preferredSource": variants[0],
                "candidates": build_candidate_sequence(normalized),
                "index": 0,
                "hadConflict": False,
            }
        )

    finalized: list[dict] = []
    finalized_compressed = set(reserved)

    while active:
        groups: dict[str, list[dict]] = defaultdict(list)
        next_active: list[dict] = []

        for item in active:
            if item["index"] >= len(item["candidates"]):
                finalized.extend(finalize_group(item, None))
                finalized_compressed.add(item["normalized"])
                continue

            candidate_meta = item["candidates"][item["index"]]
            candidate = candidate_meta["text"]

            if candidate_meta["kind"] != "original" and candidate in canonical_sources and candidate != item["normalized"]:
                item["index"] += 1
                item["hadConflict"] = True
                next_active.append(item)
                continue

            if candidate in finalized_compressed:
                item["index"] += 1
                item["hadConflict"] = True
                next_active.append(item)
                continue

            groups[candidate].append(item)

        for candidate, peers in groups.items():
            if len(peers) == 1:
                item = peers[0]
                candidate_meta = item["candidates"][item["index"]]
                finalized.extend(finalize_group(item, candidate_meta))
                finalized_compressed.add(candidate if candidate_meta["kind"] != "original" else item["normalized"])
            else:
                winner = choose_collision_winner(peers)
                winner_candidate = winner["candidates"][winner["index"]]
                finalized.extend(finalize_group(winner, winner_candidate))
                finalized_compressed.add(candidate if winner_candidate["kind"] != "original" else winner["normalized"])

                for item in peers:
                    if item is winner:
                        continue
                    item["index"] += 1
                    item["hadConflict"] = True
                    next_active.append(item)

        active = next_active

    entries.extend(finalized)
    entries.sort(key=lambda entry: (normalize_text(entry["source"]), entry["source"]))
    phrase_entries = [
        {
            "source": entry["source"],
            "compressed": entry["compressed"],
            "kind": entry["kind"],
            "reason": entry["reason"],
        }
        for entry in manual_phrases
    ]
    return entries, phrase_entries


def build_stats(entries: list[dict], phrase_entries: list[dict]) -> dict:
    stats_by_letter = {letter: 0 for letter in LETTERS}
    original_chars = 0
    compressed_chars = 0
    auto_shortened = 0
    kept_original = 0
    manual = 0
    direct_priority = 0
    collision_resolved = 0
    enriched_entries: list[dict] = []

    for entry in entries:
        source_len = len(entry["normalized"])
        compressed_len = len(entry["compressed"])
        saved = source_len - compressed_len
        ratio = 0 if source_len == 0 else saved / source_len

        original_chars += source_len
        compressed_chars += compressed_len
        stats_by_letter[entry["normalized"][0]] += 1

        if entry["strategy"] == "manual":
            manual += 1
        elif entry["strategy"] == "kept-original":
            kept_original += 1
        else:
            auto_shortened += 1
            if entry["strategy"] == "auto-edge":
                direct_priority += 1
            else:
                collision_resolved += 1

        enriched_entries.append({**entry, "saved": saved, "ratio": ratio})

    top_savings = sorted(
        enriched_entries,
        key=lambda entry: (-entry["saved"], -entry["ratio"], entry["source"]),
    )[:16]
    shortest = [
        {"source": entry["source"], "compressed": entry["displayCompressed"]}
        for entry in enriched_entries
        if len(entry["compressed"]) <= 2
    ][:18]

    return {
        "totalWords": len(entries),
        "totalPhrases": len(phrase_entries),
        "originalChars": original_chars,
        "compressedChars": compressed_chars,
        "charsSaved": original_chars - compressed_chars,
        "compressionRate": round(((original_chars - compressed_chars) / original_chars) * 100, 2),
        "autoShortened": auto_shortened,
        "keptOriginal": kept_original,
        "manual": manual,
        "skeletonOnly": direct_priority,
        "collisionResolved": collision_resolved,
        "byLetter": stats_by_letter,
        "topSavings": [
            {
                "source": entry["source"],
                "compressed": entry["displayCompressed"],
                "saved": entry["saved"],
                "ratio": round(entry["ratio"] * 100, 1),
            }
            for entry in top_savings
        ],
        "shortest": shortest,
    }


def write_data(data_dir: Path, entries: list[dict], phrase_entries: list[dict], manual_entries: list[dict]) -> None:
    stats = build_stats(entries, phrase_entries)

    if data_dir.exists():
        shutil.rmtree(data_dir)

    chunks_dir = data_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    chunk_map = {letter: [] for letter in LETTERS}
    for entry in entries:
        chunk_map[entry["normalized"][0]].append(
            [entry["source"], entry["displayCompressed"], entry["kind"], entry["reason"]]
        )

    for letter, chunk_entries in chunk_map.items():
        (chunks_dir / f"{letter}.json").write_text(
            json.dumps({"letter": letter, "count": len(chunk_entries), "entries": chunk_entries}, ensure_ascii=False),
            encoding="utf-8",
        )

    meta = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "lexiconSource": "@andsfonseca/palavras-pt-br extraido previamente e recompresso com heuristica direta, prefixos e reserva de originais canonicos",
        "methodology": [
            "Ignora acentos na resolucao do conversor para evitar colisoes artificiais entre variantes.",
            "Agrupa variantes acentuais da mesma palavra antes de decidir a abreviacao.",
            "Tenta formas curtas diretas e tambem prefixos, em vez de depender de uma unica ordem de corte.",
            "Quando varias palavras colidem, uma delas pode ficar com a forma curta e as outras sobem para candidatos maiores.",
            "Nenhuma palavra pode tomar como abreviacao o original canonico de outra palavra.",
            "Alguns atalhos manuais ultrafrequentes podem vencer um verbete literal raro, como que -> q.",
            "Mantem regras manuais apenas em atalhos muito consolidados no uso informal.",
        ],
        "letters": LETTERS,
        "stats": stats,
        "manualEntries": manual_entries,
        "samples": {
            "topSavings": stats["topSavings"],
            "shortest": stats["shortest"],
        },
    }

    (data_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    (data_dir / "phrases.json").write_text(json.dumps(phrase_entries, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    manual_entries = load_manual_entries(data_dir)
    source_words = load_source_words(data_dir)
    entries, phrase_entries = build_entries(source_words, manual_entries)
    write_data(data_dir, entries, phrase_entries, manual_entries)

    stats = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))["stats"]
    print(
        json.dumps(
            {
                "totalWords": stats["totalWords"],
                "compressionRate": stats["compressionRate"],
                "charsSaved": stats["charsSaved"],
                "manual": stats["manual"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
