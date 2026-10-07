# 01 · Naive RAG

The simplest form of retrieval-augmented generation (RAG): split a test-case
library into chunks, store them in a vector database, and answer questions in a
chat using the chunks most similar to each question. One index, one retrieval
step, no re-ranking, no query rewriting. It's the baseline to compare more
advanced RAG patterns against.

The same idea is built twice, with two different stacks:

| Version | Stack | Knowledge base | Guide |
|---|---|---|---|
| [n8n workflows](n8n%20workflows/) | n8n, Pinecone, OpenAI embeddings and `gpt-5-mini` | 100 Wingify login test cases | [README](n8n%20workflows/README.md) |
| [langflow](langflow/) | Langflow, Astra DB with NVIDIA embeddings, Groq | 500 VWO test cases | [README](langflow/README.md) |

Each folder holds its flow export, its own `data/`, screenshots of a real run,
and a README covering setup, usage and troubleshooting.
