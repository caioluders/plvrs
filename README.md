# PLVRS

Site estático em pt-BR com:

- dicionário pesquisável de palavras comprimidas
- conversor `Português -> Comprimido` e `Comprimido -> Português`
- estatísticas reais da compressão
- explicação da metodologia usada

## Como abrir

Use qualquer servidor estático simples na raiz do projeto:

```bash
python3 -m http.server 4173
```

Depois abra:

```text
http://localhost:4173
```

## Regenerar a base

Se quiser recalcular os JSONs do dicionário e das estatísticas:

```bash
python3 scripts/build_data.py
```

## Base lexical

Os arquivos em `data/` já foram gerados e estão prontos para uso no navegador.

Fonte usada:

- `@andsfonseca/palavras-pt-br`
- bases `BRISPELL` + `PYTHONPROBR`

## Estrutura

- `index.html`: layout principal
- `src/main.js`: lógica da interface, busca e conversão
- `src/styles.css`: visual
- `data/`: chunks JSON do léxico e metadados
