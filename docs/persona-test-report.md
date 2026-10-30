# 人格走查 / Persona walkthrough

11 位 18 岁以上的使用者先走了一遍第一版界面。逻辑（共享模型、调度、断点续传、云端回退）一次就过了。界面有 14 项明确的卡住点。第二遍按这些点改了文案、点击目标和分享顺序，同一套脚本 37 项全部通过。

Eleven adults walked the first pass. Sharing logic passed immediately. Fourteen interface checks failed. The second pass changed copy, targets, and share order. The same script then passed 37 of 37.

The walkthrough is `frontend/scripts/persona-walkthrough.ts`. It drives the scanner, scheduler, and download manager with fixtures, then reads the screens the personas would actually touch. It does not tap a physical phone. A development build is still required to confirm the App Group folder and a real weight download.

## Personas

| Person | What they wanted | What they tapped | What stuck |
| --- | --- | --- | --- |
| 19, Shenzhen student | A cheap weekend with a plot, then the group chat | Weekend chip, then WeChat | App opened in English. 200 km did not match the mile chips. WeChat was not first. |
| 28, Shanghai PM | Fill a sentence, edit one word, then go | Food chip, edit, Start exploring | A chip that searches immediately would feel like the app decided for her. The first pass only filled the box, with no hint that a second tap can send. |
| 35, Austin engineer | Know if weights leave the phone | Account, model card, leave the external toggle off | Privacy sat under the download button. The runtime note read like a status log. |
| 42, Guangzhou parent | Kids and grandparents, then a card for the family chat | Family chip, unlock form, share | Traveler count stayed at 1. Share was only on the Trips tab. WeChat was buried. |
| 55, Beijing empty-nester | One readable sentence and a picture to save | First chip, save | Chips were 44pt and the rest hid in a horizontal scroll with no hint. Share buttons all had the same weight. |
| 23, Toronto exchange student | English, 48 hours, a challenge for classmates | Language, 48-hour chip, challenge | Language lived only in Account. Challenge sat in the same row as X and Facebook. |
| 31, Tokyo salaryman | 48 hours and no plan | 48-hour chip, then the photo chip as an edit | One tap only filled the box. The unlock form still said 1 day. |
| 27, Los Angeles creator | A sticker, a remix prompt, a sequel | Story sticker, remix, sequel | The button said “Duet”, which is insider language. Play actions were mixed with Messages. |
| 48, Chengdu foodie couple | The local specialty, then a card for relatives | Food chip, postcard, save | Save was labeled like a QR utility. Relatives need WeChat or a picture. |
| 36, Singapore teacher | A rainy-day plan she can explain | Rainy chip, classic card, Messages | Miles had no note. The sheet did not lead with Messages and a savable card. |
| 22, Seoul design student | Night photos and a short remix link | Photo chip, sticker, remix | The sticker existed, but it did not sit in its own “play” group. |

Ages stay at 18 and above. No one under 18 was scripted.

## First run

Logic that already held:

- The 22 whitepaper keywords match QuoteShield-style ids and do not treat Mystery Getaway as one of those 22.
- A ready sibling model mounts and blocks a second download. This app’s own file wins if both exist. Partial files, tiny files, and files from outside the ecosystem are ignored.
- Current-app work runs before ecosystem work. External callers are refused until `allow_external_sharing` is `true`.
- A paused download sends `Range` and appends. A normal `200` replaces the partial file.
- With no on-device runtime linked, a mounted file still uses the cloud model. No file at all also uses the cloud.

Interface checks that failed: `wechat-first-zh`, `messages-then-save-en`, `share-groups`, `save-card-label`, `language-on-home`, `chip-hint`, `second-tap`, `mile-note`, `detail-share`, `muse-context`, `chip-target`, `privacy-before-download`, `runtime-copy`, `duet-plain`.

## What changed on the second pass

- Home has an English / 中文 switch, so Shenzhen, Toronto, and Beijing users do not have to open Account first.
- Chips are 48pt with 16pt type. Under them: tap once to fill, tap the same chip again to go, swipe for more, and a note that about 200 km uses the 250 mile tier.
- The second tap sends the text currently in the box, including an edit. The main button still starts the search.
- The family chip remembers 4 travelers and 2 days. The 48-hour and weekend chips remember 2 days. The unlock form reads that when it opens.
- After a plan is revealed, Detail has Share next to directions and opens the same trip sheet.
- Chinese share order starts with WeChat, Messages, then save. English starts with Messages, then save or print.
- The sheet is split into “Send to someone” / “发给家人朋友” and “Play with a friend” / “一起玩”. Save says “Save or print the card” / “保存图片，发给家人”. The sequel button says “Plan the sequel together” / “一起做下一程”.
- Privacy sits above the download button. The runtime sentence is one line: trip ideas use the cloud model until an on-device engine is connected, and the file stays on the phone.

## Second run

`npx tsx scripts/persona-walkthrough.ts` exited 0. 37 checks passed, including all 11 persona groups.

## Still open

These are product limits, not leftovers from the walkthrough:

- The phone does not run the model yet. Mounting a file does not change the answer path. Answers still use the server model.
- The script cannot see a real App Group container, a WeChat handoff, or a 100 MB download. Those need a development build on a phone.
- Android sibling apps still cannot rely on the public Documents folder; newer Android often refuses that write.
