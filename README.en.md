# AI Studio 1.0 — Source-Available Edition (Noncommercial)

AI Studio 1.0 organizes AI assistants into fixed workstations for gameplay, assets, integration, and verification. This source is prepared from the 1.0 commercial-candidate client. Actual purchase and cross-device authorization are not connected.

This repository is intended to make project-owned source code available for study and noncommercial distribution. Commercial use or sale of the software or source code, including providing them as part of a paid product or software service, requires separate authorization. As an express exception, users may use the software to create and sell their own works to which they hold lawful rights. Third-party dependencies remain subject to their own licenses. The LICENSE published with the repository will govern the detailed terms.

Compared with 2.6, version 1.0 uses fixed workstations and a single-task structure. Version 2.6 introduces a list of pipelines and a separate team and budget for each pipeline. The local running limit of each candidate client is different from the number of saved task configurations.

Compared with 1.0, AI Studio 4.0 adds a free-form workstation graph, MCP plugin settings for each AI, production workstations using compatible general-purpose APIs, media uploads and access assignments, and main-AI-assisted planning. Actual capabilities depend on the selected models, tools, and configuration.

The planned AI Studio 4.0 commercial full version is intended to be provided as a program without source code. Purchase and download channels are not yet open. Company website: https://tsstudiohub.com/ — this is the company homepage, not a purchase or download link.

The software has not been formally released, and the 4.0 full version is not yet available for purchase.

## Run and configure

On Windows, install Python 3.12 or a compatible version, then run `python client/store_bootstrap.py` from the repository root. The application initializes a separate local data directory. Configure the assistants, models, and tools you need before starting; third-party services require their own setup, accounts, and billing.

[中文](README.md) · [English license](LICENSE) · [中文许可](LICENSE.zh-CN.txt)
