# RAG

Retrieval-augmented generation (RAG) projects built around QA documents: a
local app that shows every stage of the pipeline, chatbots over a test-case
library from a naive baseline to an advanced pipeline with HyDE and reranking,
and QABuddy.ai, a hybrid RAG assistant over a whole QA team's knowledge
(live demo: https://qabuddy-vishnudeep-jayam.vercel.app).

![RAG Explorer: the Search tab ranking every chunk against a query](RAG_Explorer/screenshots/06-search-full.png)

## Projects

| Project | What it is | Stack |
|---|---|---|
| [RAG_Explorer](RAG_Explorer/) | A local web app that indexes a PDF and shows each stage: extracted text, chunks, embeddings, similarity scores, the top-K results and the exact prompt the model receives. Sliders for chunk size and overlap redraw the chunk map and re-rank the results live | Node, React, LanceDB, Nomic embeddings (local ONNX), Groq |
| [01_Naive_RAG](01_Naive_RAG/) | The baseline, built twice. Two n8n workflows that load 100 Jira-style login test cases into Pinecone and answer through a chat agent; and a Langflow flow that loads 500 VWO test cases into Astra DB | n8n, Pinecone, OpenAI; Langflow, Astra DB (NVIDIA embeddings), Groq |
| [02_Advanced_RAG](02_Advanced_RAG/) | Naive RAG plus HyDE (search with a hypothetical answer), Cohere reranking of 20 candidates down to 4, and a prompt that answers only from those and cites each Test Case ID | Langflow, Astra DB, Cohere Rerank, Groq |
| [RAG_QA_Buddy.Ai](RAG_QA_Buddy.Ai/) | QABuddy.ai: one cited answer from 10 sources (Selenium and Playwright code, 600 test cases, PRD, Jira, meetings, Lucid charts, docs, Jenkins). Each source is chunked by its own structure; semantic and BM25 keyword search are fused; seven QA modes (RCA, test design, flaky tests and more). [Live demo](https://qabuddy-vishnudeep-jayam.vercel.app) | Python, FastAPI, Qdrant, Qwen3-Embedding-0.6B (Ollama), tree-sitter, Groq, Vercel |

Each folder has its own README with setup and usage.

## What they cover

- **Chunking and overlap**: how chunk size changes what gets retrieved
  (RAG Explorer's sliders), and why a test case split across chunks loses its ID
  unless the ID is stored as metadata (the second Naive RAG workflow)
- **Embeddings and vector search**: local embeddings with LanceDB, and hosted
  ones with Pinecone and Astra DB, all using cosine similarity
- **Better retrieval**: HyDE and reranking, and the difference they make to the
  same question (02_Advanced_RAG)
- **Hybrid search**: dense and BM25 vectors in one Qdrant collection, fused with
  Reciprocal Rank Fusion, measured against semantic-only and keyword-only search
  on an evaluation set (RAG_QA_Buddy.Ai)
- **Grounded answers**: the projects tell the model to answer only from the
  retrieved text, cite its sources, and say so when the answer isn't there
