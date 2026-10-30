# Dream Peak \(end of content\)

Champions league is a game mode that is available only when a player is at the end of content (have completed all possible levels in 'saga'). Champions league has randomised (same levels for everyone) sets of levels that are randomised based on selected level difficulty tags (very easy, easy, medium, hard, insane).

  

Documentation is split in two categories, Soft Launch and Global Launch.

  


---

# Dream Peak Crown Update 1.3x

  

 Removed Golden Border from the spec as it conflicts with challenge mode avatars with actual golden borders

 Combined previous specs into one update spec

### What

- Players who win Dream Peak get a crown for a week
- Event Start Popup message change
- Team listing shows level completions in Dream Peak
- Remove Visual Progression related World branding from popups
    - Currently underused and only causes confusion when players move between the worlds all the time

### Why

- Slightly increased motivation to win → slightly increased Dream Peak revenue \~+5%
- Better understanding when new levels are coming → slight increase in retention \~+3%
- Team listing change has been requested by players and will make the tabs more unified in terms of information → quality of life, tiny increase in retention

### Dream Peak Crown

- When Dream Peak event ends, a short animation sequence is shown
    - Everyone sees the winner get a crown (same animation sequence for everyone)
- A crown is applied to winner´s profile for a week
    - Added to top part of the avatar
    - Everyone in the game observing leaderboards can see this
- When the next season ends, crown goes to the next winner
- Effectively on the first season no one has a crown but after that there are always players with crowns

  

#### Receiving the crown

| Description | Example Image(s) |
| --- | --- |
| - When the season ends     - New animation sequence is shown         - Player can skip parts of the sequence by tapping the screen         - Reveal skips to crowning         - Crowning skips to leaderboard     - Winner is revealed     - Winner gets the crown     - Player is communicated about the temporary nature of the Crown         - It lasts only until the next season     - Suspension is added by saying "Who's gonna be next?"     - Crown is applied to player profile and can be observed everywhere where avatar is visible |  |

  

### Level Start Popup Change

| Description | Example Image(s) |
| --- | --- |
| - Blue banner saying "Pillow plains" is removed - Source text will be changed and relocalized     - Focus on communicating that new levels are coming     - Focus on communicating that player enters the Dream Peak and can become the champion! Crown is mentioned here as well     - "NEW LEVELS COMING SOON! Enter Dream Peak to be the crowned champion!"     - Button is relabeled to "ENTER" instead of "OK" emphasizing the transition between two game modes | *Old vs New* |

### Team Listing Change

| Description | Example Image(s) |
| --- | --- |
| - Instead of only showing Dream Peak Icon     - Completed levels in Dream Peak are surfaced to the players in 'My Team' tab     - This is in line with what is shown in Global     - Trophies and Dream Peak icon are combined as one | *Old vs NEW vs what is shown in Global (in order from left to right)* |

### Remove Visual Progression World Branding

| Description | Example Image(s) |
| --- | --- |
| - Remove Visual Progression World Branding     - "Pillow Plains" on a blue banner in the example images - New version does not show these at all - This reduces the confusion between visual progression worlds and Dream Peak worlds | *Left is old, right is new. Blue text banner saying "Pillow Plains" has been completely removed.* |

  

### Requirements

#### Configs

- A/B testing
    - Crowning Feature ON/OFF
        - If feature is off then client cannot see or get crowns at all
        - If feature is on then client can see crowns on other people and also receive crown

#### Audio

- Fanfares for new animation sequence where winner receives the crown

#### Art

- Crown asset
- Golden avatar border???
- Celebratory animation sequence
    - Confetti flying, winner is revealed and crown is received

  

  

---

  

# L~~evel Release Info Update 1.xx.x (unreleased)~~

  

~~**Link to 'playable':**~~

~~<https://xd.adobe.com/view/eae8704f-a894-4400-917a-6b32e17546a9-bfbb/>~~

### ~~What~~

- ~~Promote new level releases beforehand for players who are in Dream Peak~~

### ~~Why~~

- ~~We have received a lot of feedback and it seems there is confusion about the purpose of DP~~
- ~~Make sure that the message is loud and clear~~
- ~~Create anticipation for weekly new levels~~

### ~~How~~

- ~~Dream Peak users will see additional small banner that promotes the upcoming level release~~
    - ~~"New levels in Xh:Xm" counter~~
    - ~~Tapping the banner opens info popup~~
        - ~~New levels every Saturday! Stay tuned!"~~
        - ~~New levels in Xh:Xm" counter~~
- ~~We don't have to expose the amount, just promise that there is a release~~

  

\~~~~

### ~~Requirements~~

- ~~Weekly release schedule (we already do this fortunately)~~
- ~~Time until start of next scheduled Dream Peak event is visualized~~

### ~~Open Questions~~

- ~~Should the message in the Dream Peak event start popup be more clear?"~~
    - ~~"You have completed all levels! Stay tuned for more and in the meantime play old levels and compete against other players!"~~

  

---

# Leaderboard Update 1.21.0

We have different amounts of maximum saga levels in different countries which in practice means that players who are in Dream Peak have completed different amounts of levels. This is causing some confusion.

  

Design goals

- Improve clarity by reducing the amount of unnecessary information
- Visualize more clearly when users are in Dream Peak

  

### Leaderboard Visualization

| Description | Example Image(s) |
| --- | --- |
| Leaderboard Visualization - When player reaches Dream Peak from their perspective     - Show 'Dream Peak Label' in all leaderboard situations (icon + localised text)     - THIS APPLIES TO ALL LEADERBOARDS IN THE GAME |  |

# Soft Launch

### Soft Launch FTUE

| Description | Example Image(s) |
| --- | --- |
| User enters Dream Peak for the very first time  - Dream Peak start Popup is shown - Dialog for name change      - Optional, user can choose to not change name     - Accepting confirms current name (starts with current selected)     - Closing dialog from 'X' in the corner discards any changes and closes dialog     - Uses same set of prefixes and suffixes - User lands on Dream Peak landing screen, FTUE will not be shown again for this user |  |

  

### Champions League Flow

| Description | Example Image(s) |
| --- | --- |
| - Level content is available - New season of champions league starts in parallel - Player finishes all level content - **FTUE - ONLY ONCE PER USER**     - **Player name change dialog (see image)** - League becomes available for player     - Player contributes         - Plays levels         - Gains trophies         - Placement changes - New level content becomes available - League ends - Player gets rewards accordingly - League is not available and player plays new levels |  |

### Champions League Screen

  

| Description | Example Image(s) |
| --- | --- |
| Dream Peak screen elements - Mini saga map with Red removed, Play-button with no level number - Player can still earn XP and level up by playing Dream Peak - Show the duration of the event (until next level pack) - Little banner showing total numbers of trophies earned and player's current leaderboard rank. Banner is also the access point to the full leaderboard. When winning a level, trophy flies to the banner's trophy counter. If player's leaderboard position changes, the change is animated on the banner, showing the new rank. |  |
| **Leaderboard screen** - Name & image - Time left - Scrollable list of all the competitors, showing rewards of each rank + trophies collected. Player's name is highlighted. |  |

  

### Champions League Season 

  

#### Season Scheduling

Champions League season is always active. One season lasts until the next content patch. Current idea of schedule is new content on Fridays. So effectively

- Friday to Thursday - Season 1
- Friday to Thursday - Season 2 etc

  

From the players point of view it goes roughly like this

1. Player plays content (1 season active, but hidden from player)
2. Player finishes content, Champions League Season 1 becomes available
3. Content patch, new levels and season1 ends (players rewarded accordingly)
4. Player plays content
5. Player finishes content, Champions League Season 2 becomes available
6. Content patch, new levels and season 2 ends (players rewarded accordingly)

  

 

###   
  

### Completing a Level in Champions League

| Description | Example Image(s) |
| --- | --- |
| When player completes a level in Champions League - Player returns to CL landing screen - Animation shows gained Trophy flying to rank/trophy banner     - Number increases     - Rank updates - Player can now choose to play more or for example open the rank banner to get more info about the league     - By simply tapping it |  |

  

### Champions League Ranking Screen

| Description | Example Image(s) |
| --- | --- |
| Can be accessed from CL landing screen by tapping the trophy/rank banner  - Name & image - Time left - Scrollable list of all the competitors, showing rewards of each rank + trophies collected. Player's name is highlighted. |  |

  

### Champions League Ending Screen

| Description | Example Image(s) |
| --- | --- |
| League Ending screen is shown when new level content is available  - Triggers when there is new content available through new configs     - Rewards the user with rewards based on rank when the league ended         - To eliminate any timing issues this should probably be from the client viewpoint? Note: If the player doesn't receive any rewards, the call-to-action button will say "Continue" |  |

  

### Level Set Randomisation and Tags

In Dream Peak, players play through random levels, gaining 'points' every time they successfully complete a level

- ~~Level sequence is random~~
    - ~~Uses seed, the sequence is the same for all players~~
- ~~Uses only levels with specific tags, defined in configuration~~
    - ~~Difficulty tags~~
    - ~~Tutorial tags (not sure if it's supported yet from editor side)~~

  

- Levels are randomly picked based on difficulty from a predefined pool
    - Client uses level indexes as identifiers (old system used file names)
- Example: 
    - Server randomizes first level to be played
        - Looks for a level that has difficulty 1
        - Checks that level´s index and sends it to the client
        - Client plays a level with that index, regardless of what it actually is

##### Initial Level Difficulty Sequence (Difficulty Tags)

Easy 1  
Easy 1  
Average 2  
Tough 3  
Hard 4  
Tough 3  
Hard 4  
Extreme 5  
Hard 4  
Tough 3  
Hard 4  
Extreme 5  
Tough 3  
Hard 4  
Extreme 5

  
Dream Peak Buckets

- Players are put into buckets of 20 players
- New bucket is created when the previous one is full
    - High volume of players should prevent any serious timing issues (players getting too big lead)
- Segmentation will be introduced later, for SL purposes the buckets are just filled as new players reach end of content

### Dream Peak Rewards

Positions

  

| Position | Coins | Powerup |
| --- | --- | --- |
| 1 | 500 | Comet |
| 2 | 300 | Slingshot |
| 3 | 200 | Slingshot |
| 4 | 100 | Slingshot |
| 6-10 |  | Shuffle |

###   
Dream Peak revisit - mini-saga

Dream Peak with mini-saga would be otherwise similar to normal Dream Peak with leaderboard competition, but include X steps "saga" map with threshold levels for rewards.

|  |  |
| --- | --- |
| Players play Dream Peak normally by completing levels and collecting trophies. Additionally there are for example 3 threshold levels with certain amount of trophies needed to get chest rewards that keep improving the higher the player gets.  Example setup: - 10 trophies needed: 1x Shuffle & Hammer + 15 coins - 25 trophies needed: 2x Hammer + 35 coins - 75 trophies needed: 1x comet + 75 coins |  |

  

### Dream Peak global leaderboard

###   
  
  
  
 
