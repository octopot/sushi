#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

// Window operations and these focus transitions run on AppKit's main thread.
static NSRunningApplication *previousApplication;

void sushi_remember_frontmost(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    if (app && app.processIdentifier != NSProcessInfo.processInfo.processIdentifier) {
        previousApplication = app;
    }
}

// A transparent window's shadow follows the alpha of its content: the rounded glass.
// AppKit caches that outline, so recompute it once the content has redrawn.
static void refresh_shadow(NSWindow *window) {
    // Apply the corner mask from shape_window; AppKit only re-reads it when told.
    SEL changed = NSSelectorFromString(@"_cornerMaskChanged");
    if ([window respondsToSelector:changed]) ((void (*)(id, SEL))objc_msgSend)(window, changed);
    [window invalidateShadow];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        [window invalidateShadow];
    });
}

// The web page paints no window-shaped layer, so the glass carries the legibility tint.
// As the glass's content view the fill is clipped to the glass's own continuous corner.
// NSGlassEffectView.tintColor tints too faintly for body text over a busy wallpaper.
@interface SushiTint : NSView
@end

@implementation SushiTint
- (BOOL)wantsUpdateLayer { return YES; }
- (void)updateLayer {
    BOOL dark = [[self.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
    NSColor *tint = dark ? [NSColor colorWithSRGBRed:24 / 255.0 green:24 / 255.0 blue:27 / 255.0 alpha:0.52]
                         : [NSColor colorWithSRGBRed:250 / 255.0 green:250 / 255.0 blue:250 / 255.0 alpha:0.56];
    self.layer.backgroundColor = tint.CGColor;
}
- (void)viewDidChangeEffectiveAppearance { self.needsDisplay = YES; }
@end

// macOS 25 and older get the untinted Visual Effect fallback.
static void tint_glass(NSWindow *window, int attempts) {
    Class glass = NSClassFromString(@"NSGlassEffectView");
    if (!glass) return;
    for (NSView *view in window.contentView.subviews) {
        if ([view isKindOfClass:glass]) {
            if (![[(id)view contentView] isKindOfClass:SushiTint.class]) {
                SushiTint *tint = [[SushiTint alloc] initWithFrame:view.bounds];
                tint.wantsLayer = YES;
                tint.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
                [(id)view setContentView:tint];
            }
            return;
        }
    }
    // Tauri inserts the glass in a later main-thread task; try again shortly.
    if (attempts <= 0) return;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        tint_glass(window, attempts - 1);
    });
}

// A borderless window has no corner mask, so the window server is free to outline, clip and
// shadow it with a shape other than the glass. Supply the glass outline: a stretchable mask
// with the same 26pt continuous corner. This overrides AppKit's private -_cornerMask (as
// Electron does for windows with rounded vibrancy); on a system without it nothing changes.
static const CGFloat CORNER = 26;

static NSImage *corner_mask(void) {
    static NSImage *mask;
    if (mask) return mask;
    CGFloat side = ceil(CORNER * 1.6) * 2 + 1, scale = 2;
    CALayer *shape = [CALayer layer];
    shape.frame = CGRectMake(0, 0, side, side);
    shape.cornerRadius = CORNER;
    shape.cornerCurve = kCACornerCurveContinuous;
    shape.backgroundColor = NSColor.blackColor.CGColor;
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, side * scale, side * scale, 8, 0, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGContextScaleCTM(context, scale, scale);
    [shape renderInContext:context];
    CGImageRef bitmap = CGBitmapContextCreateImage(context);
    mask = [[NSImage alloc] initWithCGImage:bitmap size:NSMakeSize(side, side)];
    CGFloat cap = floor(side / 2);
    mask.capInsets = NSEdgeInsetsMake(cap, cap, cap, cap);
    mask.resizingMode = NSImageResizingModeStretch;
    CGImageRelease(bitmap);
    CGContextRelease(context);
    CGColorSpaceRelease(space);
    return mask;
}

static void shape_window(NSWindow *window) {
    SEL selector = NSSelectorFromString(@"_cornerMask");
    Method inherited = class_getInstanceMethod(NSWindow.class, selector);
    if (!inherited) return;
    class_addMethod(window.class, selector, imp_implementationWithBlock(^NSImage *(__unused id self) { return corner_mask(); }), method_getTypeEncoding(inherited));
}

void sushi_prepare_window(void *native) {
    NSWindow *window = (__bridge NSWindow *)native;
    static id resized;
    if (!resized) {
        resized = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidResizeNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            refresh_shadow(note.object);
        }];
    }
    if (NSApp.hidden) [NSApp unhideWithoutActivation];
    shape_window(window);
    // Borderless windows have no shadow unless asked for one.
    window.hasShadow = YES;
    tint_glass(window, 40);
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    behavior &= ~(NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenNone);
    window.collectionBehavior = behavior | NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary;
}

void sushi_refresh_shadow(void *native) {
    refresh_shadow((__bridge NSWindow *)native);
}

void sushi_activate(void) {
    [NSApp activateIgnoringOtherApps:YES];
}

void sushi_restore_frontmost(void) {
    if (previousApplication && !previousApplication.terminated) {
        if (@available(macOS 14.0, *)) {
            [NSApp yieldActivationToApplication:previousApplication];
            [previousApplication activateFromApplication:NSRunningApplication.currentApplication options:0];
        } else {
            [previousApplication activateWithOptions:0];
        }
    } else {
        // Nobody to hand focus back to (e.g. shown by a reopen while already frontmost):
        // hiding the app makes the system activate the next app. sushi_prepare_window unhides.
        [NSApp hide:nil];
    }
    previousApplication = nil;
}

bool sushi_is_active(void) {
    return NSApp.active;
}

bool sushi_copy(const unsigned char *bytes, size_t count) {
    @autoreleasepool {
        NSString *text = [[NSString alloc] initWithBytes:bytes length:count encoding:NSUTF8StringEncoding];
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        [board clearContents];
        return [board setString:text forType:NSPasteboardTypeString];
    }
}

// Where Launch Services finds the app with this bundle identifier, as the Finder would.
// Writes a NUL-terminated path into out and returns true, or false when no app is registered.
bool sushi_app_path(const char *bundle_id, char *out, size_t size) {
    @autoreleasepool {
        NSString *identifier = [NSString stringWithUTF8String:bundle_id];
        NSURL *url = identifier ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:identifier] : nil;
        return url.fileURL && [url getFileSystemRepresentation:out maxLength:size];
    }
}

void sushi_stage_appearance(const char *name) {
    if (!strcmp(name, "dark")) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    else if (!strcmp(name, "light")) NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
}

// Stage mode: render the window for screenshots without anyone seeing it. WindowServer
// only composites glass over what lies below it on a display, so both the window and its
// backdrop sit under the desktop picture instead of off-screen. They never take focus.
static NSWindow *backdrop;

// Level of the desktop picture covering rect (AppKit coordinates), or NSNotFound.
// macOS 26+ draws it in a WallpaperAgent window two levels below kCGDesktopWindowLevel.
static NSInteger wallpaper_level(NSRect rect) {
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame);
    CGRect target = CGRectMake(NSMinX(rect), top - NSMaxY(rect), NSWidth(rect), NSHeight(rect));
    CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    NSInteger level = NSNotFound;
    for (NSDictionary *info in (__bridge NSArray *)list) {
        CGRect bounds;
        NSInteger layer = [info[(id)kCGWindowLayer] integerValue];
        NSString *owner = [NSRunningApplication runningApplicationWithProcessIdentifier:[info[(id)kCGWindowOwnerPID] intValue]].bundleIdentifier;
        if (([owner isEqual:@"com.apple.wallpaper.agent"] || layer == CGWindowLevelForKey(kCGDesktopWindowLevelKey)) &&
            [info[(id)kCGWindowAlpha] doubleValue] == 1.0 &&
            CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds) &&
            CGRectContainsRect(bounds, target)) {
            level = MIN(level, layer);
        }
    }
    if (list) CFRelease(list);
    return level;
}

long sushi_stage_present(void *native, const char *image_path, long *backdrop_number) {
    NSWindow *window = (__bridge NSWindow *)native;
    NSRect frame = window.frame;
    NSRect around = NSInsetRect(frame, -160, -160);
    NSInteger wallpaper = wallpaper_level(NSInsetRect(around, -80, -80));
    if (wallpaper == NSNotFound) {
        fprintf(stderr, "SUSHI_STAGE: no desktop picture covers the stage area; refusing to show windows.\n");
        return -1;
    }
    NSInteger below = wallpaper - 1;

    NSImage *image = nil;
    if (image_path) image = [[NSImage alloc] initWithContentsOfFile:@(image_path)];
    if (!image && NSScreen.mainScreen) {
        NSURL *url = [NSWorkspace.sharedWorkspace desktopImageURLForScreen:NSScreen.mainScreen];
        if (url) image = [[NSImage alloc] initWithContentsOfURL:url];
    }
    backdrop = [[NSWindow alloc] initWithContentRect:around styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    backdrop.releasedWhenClosed = NO;
    backdrop.ignoresMouseEvents = YES;
    backdrop.hasShadow = NO;
    backdrop.level = below - 1;
    NSView *content = backdrop.contentView;
    content.wantsLayer = YES;
    if (image) {
        content.layer.contents = image;
        content.layer.contentsGravity = kCAGravityResizeAspectFill;
    } else {
        CAGradientLayer *gradient = [CAGradientLayer layer];
        gradient.frame = content.bounds;
        gradient.colors = @[(id)[NSColor colorWithSRGBRed:0.10 green:0.12 blue:0.22 alpha:1].CGColor,
                            (id)[NSColor colorWithSRGBRed:0.35 green:0.15 blue:0.30 alpha:1].CGColor];
        [content.layer addSublayer:gradient];
    }
    // Under the wallpaper the window counts as occluded and WebKit would stop painting
    // after the stage script reloads the page. Stage-only use of WebKit SPI.
    SEL occlusion = NSSelectorFromString(@"_setWindowOcclusionDetectionEnabled:");
    for (NSView *parent in window.contentView.subviews) {
        for (NSView *view in [parent.subviews arrayByAddingObject:parent]) {
            if ([view respondsToSelector:occlusion]) ((void (*)(id, SEL, BOOL))objc_msgSend)(view, occlusion, NO);
        }
    }
    window.ignoresMouseEvents = YES;
    window.level = below;
    window.hasShadow = YES;
    [backdrop orderFrontRegardless];
    [window orderFrontRegardless];
    refresh_shadow(window);

    signal(SIGTERM, SIG_IGN);
    static dispatch_source_t term;
    term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(term, ^{ exit(0); });
    dispatch_resume(term);
    *backdrop_number = backdrop.windowNumber;
    return window.windowNumber;
}
