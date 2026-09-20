export async function validateCamera(page){
 const position=()=>page.evaluate(()=>river.navigation.position.toArray());
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 const idle=await position();await page.waitForTimeout(300);if(distance(idle,await position())>1e-8)throw Error('Camera moved without input');
 await page.locator('canvas').click({position:{x:650,y:400}});
 const waterTime=await page.evaluate(()=>river.time);
 await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');const moved=await position(),normalDistance=distance(idle,moved);if(normalDistance<.8)throw Error('W did not fly forward');
 await page.waitForTimeout(180);if(distance(moved,await position())>1e-8)throw Error('Camera drift after key release');
 if(waterTime!==await page.evaluate(()=>river.time))throw Error('Camera flight resumed paused water');
 await page.keyboard.down('Shift');await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');await page.keyboard.up('Shift');const boosted=distance(moved,await position());if(boosted<normalDistance*2.5)throw Error('Shift boost failed');
 const beforeUp=await position();await page.keyboard.down('e');await page.waitForTimeout(200);await page.keyboard.up('e');if((await position())[1]<=beforeUp[1]+.5)throw Error('E did not ascend');
 const oldAngles=await page.evaluate(()=>[river.navigation.yaw,river.navigation.pitch]);await page.mouse.move(650,400);await page.mouse.down();await page.mouse.move(760,455,{steps:5});await page.mouse.up();const angles=await page.evaluate(()=>[river.navigation.yaw,river.navigation.pitch]);if(Math.abs(angles[0]-oldAngles[0])<.2||Math.abs(angles[1]-oldAngles[1])<.1)throw Error('Drag look failed');
 const wheelBefore=await position();await page.mouse.wheel(0,-100);await page.waitForTimeout(100);if(distance(wheelBefore,await position())<1)throw Error('Scroll flight failed');
 await page.locator('#flow').focus();const focusBefore=await position();await page.keyboard.down('w');await page.waitForTimeout(100);await page.keyboard.up('w');if(distance(focusBefore,await position())>1e-8)throw Error('Camera moved while editing UI');
 await page.evaluate(()=>{river.navigation.setView(0);});
 return {idleStable:true,releaseStops:true,flightWhileWaterPaused:true,normalDistance,boostDistance:boosted,dragLook:true,scrollFlight:true,interfaceFocusRespected:true};
}
