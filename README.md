# RAG

Two retrieval-augmented generation (RAG) projects, both built around QA
documents: one a local app that shows every stage of the pipeline, the other a
chatbot over a test-case library.

![RAG Explorer: the Search tab ranking every chunk against a query](RAG_Explorer/screenshots/06-search-full.png)

## Projects

| Project | What it is | Stack |
|---|---|---|
| [RAG_Explorer](RAG_Explorer/) | A local web app that indexes a PDF and shows each stage: extracted text, chunks, embeddings, similarity scores, the top-K results and the exact prompt the model receives. Sliders for chunk size and overlap redraw the chunk map and re-rank the results live | Node, React, LanceDB, Nomic embeddings (local ONNX), Groq |
| [01_Naive_RAG](01_Naive_RAG/) | Two n8n workflows that load 100 Jira-style login test cases into Pinecone and answer questions about them through a chat agent that may only use what it retrieved | n8n, Pinecone, OpenAI `text-embedding-3-large`, `gpt-5-mini` |

Each folder has its own README with setup and usage.

## What they cover

- **Chunking and overlap**: how chunk size changes what gets retrieved
  (RAG Explorer's sliders), and why a test case split across chunks loses its ID
  unless the ID is stored as metadata (the second Naive RAG workflow)
- **Embeddings and vector search**: local embeddings with LanceDB, and hosted
  ones with Pinecone, both using cosine similarity
- **Grounded answers**: both projects tell the model to answer only from the
  retrieved text, cite its sources, and say so when the answer isn't there
