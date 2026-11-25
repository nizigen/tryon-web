# PoseWear pose references

The images in this directory are fixed, locally served pose references for
the studio workflow. They come from [PoseWear](https://posewear.pages.dev/),
whose source page states that the pose images are CC0 1.0: commercial use and
modification are allowed without attribution.

The application uses only the skeletal pose and body mechanics. It explicitly
ignores the reference person's identity, face, hair, clothing, phone,
accessories, background, framing and art style. The files are copied into this
repository to keep the three-pose workflow reproducible and are not treated as
a model or clothing asset pack.

| App preset | PoseWear ID | File | Role |
| --- | --- | --- | --- |
| `contrapposto` | P015 | `P015.png` | standing, hand at waist |
| `hand-behind-head` | P020 | `P020.png` | standing, hand behind head |
| `over-shoulder` | P017 | `P017.png` | standing, over-shoulder look |
| `duck-sit` | P041 | `P041.webp` | seated, suitable for skirts |
| `crouch-chin` | P063 | `P063.webp` | low crouch, chin on hand |
| `lying-overhead` | P049 | `P049.webp` | reclining, extended silhouette |

The stable PoseWear index is also retained in
`C:/GitHub/PoseWear-人物资产/workflow/catalog/poses.json`. Source evidence at
capture time is
`C:/GitHub/PoseWear-人物资产/sources/provenance/posewear-page.txt`, including
the CC0 1.0 notice and the request not to republish the library in bulk.

These six files are byte-for-byte copies from that project's `sources/pose/`
directory; their source names use the `full_single_<id>_front` pattern.
Verified SHA-256 pairs:

| Local file | Source file | SHA-256 |
| --- | --- | --- |
| `P015.png` | `full_single_P015_front.png` | `51F54CEB4D8115F6E29A36A9583A88F896314304101CA035091A1D30394E80AA` |
| `P017.png` | `full_single_P017_front.png` | `875CEC3417F669E0F1E420D770491BBCE2C8CD20B8EC97DC728E2E480929568A` |
| `P020.png` | `full_single_P020_front.png` | `E43B992358A244D65987C8B318BD4265310BCA64D9FAE4C7D3F01900FE5448F8` |
| `P041.webp` | `full_single_P041_front.webp` | `A93B4EE69E4C12B9A18E8DE0356369FD1A99ABA9EAAB658BA8872CE53CB57189` |
| `P049.webp` | `full_single_P049_front.webp` | `FE2E213073C941F75D11FA2384FA372CBCA1541AB44962447BDFC3DAD16B3698` |
| `P063.webp` | `full_single_P063_front.webp` | `C30DF7C1CCE94FE5D70A440D1A18BFD06433079E790374932AD2FAEB5CAB80CD` |
