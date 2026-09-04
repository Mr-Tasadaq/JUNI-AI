# Neural-schema research notes

## Primary source: uploaded book

Source file: `/home/ubuntu/upload/neuralnetworksanddeeplearning.pdf`.

The book’s opening pages describe neural networks as systems that learn solutions from observational data rather than receiving every rule explicitly. The table of contents identifies architectural themes relevant to JUNI: layered neural-network architecture, gradient descent, backpropagation, cross-entropy, overfitting and regularization, weight initialization, training difficulty in deep networks, convolutional networks, and an appendix questioning whether intelligence can be reduced to a simple algorithm. The book also frames the visual system as a sequence of progressively more complex processing stages, but this is an analogy rather than evidence that JUNI should replicate biology.

Schema implication: represent JUNI as connected stages with explicit observations, representations, decisions, outcomes, and evaluation signals; keep durable user memory and knowledge separate from model parameters; track uncertainty and provenance instead of treating every output as truth. Training concepts such as regularization and validation suggest that any future JUNI learning loop needs held-out evaluation, conflict detection, and safeguards against overfitting to a single user interaction.

## Official online edition

Michael Nielsen’s official online book: [Neural Networks and Deep Learning](http://neuralnetworksanddeeplearning.com/).

The official page describes the book as teaching neural networks as a biologically inspired programming paradigm that learns from observational data, and deep learning as techniques for learning in neural networks. It links the chapters on architecture, backpropagation, improving learning, training difficulty, and deep learning. It also states that the work is licensed under Creative Commons Attribution-NonCommercial 3.0 and cites the book as Michael A. Nielsen, *Neural Networks and Deep Learning*, Determination Press, 2015.

## Research cross-check leads

Search results identified the following research sources for follow-up cross-checking:

- Bengio, Courville, and Vincent, “Representation Learning: A Review and New Perspectives,” IEEE TPAMI, 2013: https://ieeexplore.ieee.org/abstract/document/6472238/
- Wang et al., “A Comprehensive Survey of Continual Learning,” arXiv, 2023: https://arxiv.org/abs/2302.00487
- Khosla, Zhu, and He, “Survey on Memory-Augmented Neural Networks: Cognitive Insights to AI Applications,” arXiv, 2023: https://arxiv.org/abs/2312.06141
- Santoro et al., “Meta-Learning with Memory-Augmented Neural Networks,” PMLR, 2016: https://proceedings.mlr.press/v48/santoro16.html

These sources should be used to distinguish learned representations, external memory/retrieval, and continual-learning risks. The planned JUNI schema should not imply that adding memory records retrains a foundation model.

## Cross-checked research findings

The continual-learning survey by Wang, Zhang, Su, and Zhu defines continual learning as incrementally acquiring, updating, accumulating, and exploiting knowledge over a system’s lifetime. It identifies catastrophic forgetting as a central limitation and frames the design objective as a stability–plasticity trade-off with intra-task and inter-task generalizability under resource constraints. Source: [A Comprehensive Survey of Continual Learning: Theory, Method and Application](https://arxiv.org/abs/2302.00487), arXiv:2302.00487v3, revised 6 February 2024.

Schema implication: JUNI should model proposed learning separately from accepted memory. New observations or user feedback should create candidate updates with evaluation evidence, policy checks, and conflict handling; they should not silently rewrite durable user memory or imply that the foundation model has been retrained.

The memory-augmented neural-network survey by Khosla, Zhu, and He describes systems that combine neural computation with memory mechanisms and surveys sensory, short-term, and long-term memory analogies, along with architectures such as Hopfield Networks, Neural Turing Machines, Memformer, and Neural Attention Memory. It discusses applications across NLP, computer vision, multimodal learning, and retrieval models. Source: [Survey on Memory-Augmented Neural Networks: Cognitive Insights to AI Applications](https://arxiv.org/abs/2312.06141), arXiv:2312.06141v2, revised 13 December 2023.

Schema implication: JUNI should distinguish working context, episodic experience, semantic knowledge, and user-approved durable memory, while representing retrieval as a traceable operation that points to source records. “Memory-like” product layers are orchestration and storage constructs, not claims of consciousness or biological equivalence.
