# Mighty Ice Cream \(Wager\)

> Synopsis
> 
> The player collects all bird boosters over the course of multiple levels. After winning a level they can decide to either submit their score to the leaderboard, or keep playing to increase their score. After submitting, or after a level loss, the score resets to 0. High leaderboard positions are rewarded with prizes.   
> 
> ## Narrative
> 
> Mighty Eagle is a teen with a need of a part-time job, so he starts selling ice cream to the excited birds. The more levels in a row the player plays, the higher the pile of ice cream (1 level = 1 scoop). After submitting, the birds get to keep the pile of scoops, but if a level is lost the tower topples over and the ice cream is lost. Either way, the player then needs to start building a new stack from scratch. 
> 
> 

## Table of Contents

## Team Members

  

|  |
| --- |

  

  

| Name | Role |
| --- | --- |
|  @Former user (Deleted)Sylvia Smatanová | Owner/Designer(s) |
| @Anastasia Kuprina (Deactivated)  | PM(s) |
|  | Engineer(s) |
|  | Artist(s) |

  

## Goals

- Increasing motivation to purchase +5 moves and spend boosters to keep building a streak of 1st time wins 
- Allows the player a lot of agency, deciding to continue playing or to play it safe between levels 
- Hight risk, high reward 
- Targets competitive players who can get invested in progressing in the event
- Increasing your score fells satisfying  
- Fills the gap of a mid-lenght competitive event in the event calendar 

## Feature Breakdown


## Event start

Event starts when scheduled. If the set start time is before player opens the app, the event starts before the player has completed their first level of the session. 

## Flow

- Event Badge in the Main screen becomes available (shows timer + relative position in the leaderboard) 
- Pre-level screen: event token icon + timer is shown in the "win to collect section" (if tapped shows full screen tutorial)
- In level: event counts each created bird (includes all birds, as well as win streak, pre-level boosters etc.) Each time a bird is created a small +1 with the event icon is flashed. This is brief and non-intrusive, similar to how we do it for already existing bird collection events. Different birds have different score values (Red \< Chuck \< Bomb). 

***Example Image(s)***

  

## Level Win

When level is won, all event score (birds created) gets added together. In the "level complete" screen. This means a brief number animation: starting at the current score, + x (birds created in this last completed level), and ending on the sum of total score.  

  

If this is the first time the player sees this event, a full screen tutorial is shown after first level complete screen, before moving on to the after-win leaderboard. 

  

After-win Leaderboard

- If this is the first level the player has completed during this event, the after-win leaderboard is shown 
- If this is not the first level the player has completed, but the current score is higher than previously submitted score (or there is no previously submitted score), the after-win leaderboard is shown. 
- If the current score of the player is lower then previously submitted score, the after-win leaderboard is skipped 

  

This screen consists of:

- Info button: Opens full screen tutorial 
- Title + timer 
- Illustration: Mighty Eagle as a teen + his ice cream cart 
- Leaderboard itself: 50 players (configurable), scrollable. Shows all position of players public (submitted) score, players submitted score (if any), and a "ghost" - position the player would be at if submitted in this moment. Prizes should be configurable, and event medals can be also given in this event. 
- Ice Cream stack: left of the leaderboard, each completed level is represented by one scoop. A new scoop is added each consecutive level win, until they reach the top (should look like it continues with imaginary progress off screen)
- Currant Score counter: Shows players active score 
- Submit button: Submits the new score to the leaderboard, after which the active score is reset to 0. Triggers an animation of the ice cream stack flying towards the illustration, happy birds receiving ice cream.
- Keep Going button: Keeps the active score as is - to be increased in the following level attempt. 
- 5 minute warning: If the event is running out of time, player is reminded with a warning flash to make sure they understand the event is ending.  
- No X available, player must exit this screen by making a choice (submit or continue)

***Example Image(s)***


## Level Fail

If the player runs out of moves the loss aversion is shown with high priority. It shows current active score being reset to 0. If the player chooses not to purchase +5 moves and looses the level, an overlay with a quick animation is shown: Ice cream pile topping over, ice cream splats on the ground, and birds in the background being very sad. 

  

***Example Image(s)***

 

## Event Screen

Opening the event screen from the main menu shows a variant of the Leaderboard shown after level win, but with some key differences: 

-  X button is available to exit this screen 
- Submit / keep going buttons are not available, since choice always has to be made after level win and before the player enters the main screen (to prevent the decision being influenced by possible hard/extreme level following) 

  

## Event Completion 

The event is concluded the moment the event timer runs out. Players are awarded prizes according to their leaderboard positions. All non-submitted score is discarded. If the player returns to the game after the event ended, they can open the event screen from the main menu (! notification) and collect their rewards form there (if any). The event badge disappears from the main menu after the prize has been claimed. If the player ended at a position with no rewards, the badge just disappears immediately (no ! notification is needed).       

***Example Image(s)***


  

## Re-skinable Theme

It should be easy to add small seasonal touches to the event by theming the ice cream cart, re-colouring the ice cream scoops etc. 

Examples of themes:

- Spring
- Christmas 
- Haloween 
- Valentines 
- Easter 
- etc. 

  

***Example Image(s)***



## Tuning Strategy

- Amount of people in each leaderboard (50 default) 
- Event schedule (amount of time available)
- Rewards config
- Repeatable
- Event requirements (player level, etc.)

## References

Lilly's Garden 

 

  

## Questions & Answers

- **What happens if the app freezes / is killed half way through a level?** If a life is lost = score resets 
- **Do all birds count?** Yes. Including pre-level boosters, win streak etc. ALL created birds. 

## Implementation Notes

Technically, Wager event is a type of Collection event in Beacon calendar.

Unlike with most other types of events, overlapping Collection events are allowed during validation.

Leaderboards, however, are not updated automatically, but require a special operation *WagerScoreSubmit  
*

\*  
*Client keeps track of **current score** in** event state**. Which is set to 0 if failing a level or when submitting a score.

Server keeps track of **leaderboard score**. Which is only changed when submitting a score.  
  
  
***For now, do not overlap Wager Event with Endless level!! ***
