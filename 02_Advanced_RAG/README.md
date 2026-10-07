# 02 · Advanced RAG

[Naive RAG](../01_Naive_RAG/) with three upgrades that change what the model
gets to read and how it uses it:

- **HyDE**: a model first writes a hypothetical answer, and that is what
  searches the vector database, because it reads more like the stored test
  cases than a short question does.
- **Reranking**: the search fetches 20 candidates, and Cohere Rerank keeps the
  4 that best fit the original question.
- **A grounded prompt**: the model answers only from those 4 and cites each
  Test Case ID.

| Version | Stack | Knowledge base | Guide |
|---|---|---|---|
| [langflow](langflow/) | Langflow, Astra DB with NVIDIA embeddings, Cohere Rerank, Groq | The 500 VWO test cases ingested by [01_Naive_RAG](../01_Naive_RAG/langflow/) | [README](langflow/README.md) |

For the question *"give me the negative test cases for the login scenario"*,
Naive RAG answered with invented IDs and a generic login form. This version
answers with four real cases from the library: `INVALID-016`, `INVALID-046`,
`INVALID-038` and `INVALID-039`.
